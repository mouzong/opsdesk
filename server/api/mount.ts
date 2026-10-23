import express, { type Request, type Response, type Router } from 'express';
import Busboy from 'busboy';
import { LIMITS } from '../../shared/constants.js';
import { apiAuth, fingerprint, IDEMPOTENCY_KEY, IdempotencyStore } from '../auth.js';
import type { AppContext } from '../context.js';
import { AppError, notFound } from '../errors.js';
import type { createHealthService } from '../health.js';
import type { ApplyHooks } from '../importExport.js';
import * as v from '../validation.js';
import { currentEtag, ifMatchSatisfied } from './etag.js';
import type { Ctx, Out, RouteDef } from './registry.js';
import { routes } from './routes.js';

const toExpress = (p: string) => p.replace(/\{(\w+)\}/g, ':$1');

/** Reads one uploaded file plus small text fields. The file is decoded as UTF-8 text and never executed or stored. */
function readMultipart(req: Request): Promise<{ fields: Record<string, string>; file: { text: string; filename: string } | null }> {
  return new Promise((resolve, reject) => {
    let bb: Busboy.Busboy;
    try {
      bb = Busboy({ headers: req.headers, limits: { fileSize: LIMITS.importBytes, files: 1, fields: 12, fieldSize: 4096, parts: 16 } });
    } catch {
      reject(new AppError(400, 'bad_multipart', 'Malformed multipart/form-data request.'));
      return;
    }
    const fields: Record<string, string> = {};
    let file: { text: string; filename: string } | null = null;
    let tooLarge = false;
    bb.on('field', (name, value) => { fields[name] = value; });
    bb.on('file', (name, stream, info) => {
      if (name !== 'file') { stream.resume(); return; }
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('limit', () => { tooLarge = true; });
      stream.on('end', () => { file = { text: Buffer.concat(chunks).toString('utf8'), filename: (info.filename ?? "").slice(0, 120) }; });
    });
    bb.on('filesLimit', () => reject(new AppError(400, 'bad_multipart', 'Upload exactly one file.')));
    bb.on('error', () => reject(new AppError(400, 'bad_multipart', 'Malformed multipart/form-data request.')));
    bb.on('close', () => {
      if (tooLarge) reject(new AppError(413, 'too_large', `The uploaded file exceeds ${LIMITS.importBytes / 1024 / 1024} MB.`));
      else resolve({ fields, file });
    });
    req.pipe(bb);
  });
}

export interface ApiMountOptions {
  health: ReturnType<typeof createHealthService>;
  importHooks?: ApplyHooks | undefined;
}

export function createApiRouter(ctx: AppContext, opts: ApiMountOptions): Router {
  const router = express.Router();
  const idem = new IdempotencyStore();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.use(apiAuth(ctx));
  router.use('/import', express.json({ limit: '7mb' }));
  router.use(express.json({ limit: '256kb' }));

  const handle = (r: RouteDef) => async (req: Request, res: Response) => {
    const auth = res.locals.auth as Ctx['auth'];
    const params = r.params ? (v.parse(r.params, req.params) as Record<string, string>) : (req.params as Record<string, string>);
    const query = r.query ? v.parse(r.query, req.query) : {};

    let rawBody: unknown = req.body;
    const isMultipart = (req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data');
    if (isMultipart) {
      if (!r.multipart || !r.fromMultipart) throw new AppError(415, 'unsupported_media_type', 'This endpoint does not accept multipart uploads.');
      if (auth !== 'bearer') throw new AppError(415, 'unsupported_media_type', 'Multipart uploads require bearer-token authentication.');
      const m = await readMultipart(req);
      rawBody = r.fromMultipart(m.fields, m.file);
    }
    const body = r.body ? v.parse(r.body, rawBody ?? {}) : undefined;

    // Safe retries: replay the first response for a repeated Idempotency-Key.
    const keyHeader = req.headers['idempotency-key'];
    let storeKey: string | undefined;
    if (r.idempotencyKey && keyHeader !== undefined) {
      if (typeof keyHeader !== 'string' || !IDEMPOTENCY_KEY.test(keyHeader)) {
        throw new AppError(400, 'validation_error', 'Idempotency-Key must be 8-128 characters from A-Z a-z 0-9 . _ : -', { 'Idempotency-Key': 'Invalid format.' });
      }
      storeKey = `${r.operationId}:${keyHeader}`;
      const fp = fingerprint(r.method, req.originalUrl, rawBody);
      const hit = idem.get(storeKey);
      if (hit) {
        if (hit.fingerprint !== fp) throw new AppError(422, 'idempotency_key_reuse', 'This Idempotency-Key was already used with a different request.');
        for (const [k, val] of Object.entries(hit.headers)) res.setHeader(k, val);
        res.setHeader('Idempotent-Replayed', 'true');
        res.status(hit.status).json(hit.body);
        return;
      }
      (res.locals as any).idemFp = fp;
    }

    // `db` is resolved lazily so routes that never touch it (health) still answer while the database is down.
    const make = (tx?: Ctx['db']): Ctx => ({
      app: ctx, get db() { return tx ?? ctx.db; }, req, res, params, query, body, auth, health: opts.health, requestId: res.locals.requestId, importHooks: opts.importHooks,
    });

    let out: Out;
    const ifMatch = req.headers['if-match'];
    if (r.conditional && typeof ifMatch === 'string' && r.method !== 'get') {
      // Check the validator and apply the change in ONE transaction so nothing can slip in between.
      out = await ctx.db.transaction(async (tx) => {
        const current = await currentEtag(tx, r.conditional!, params.id!);
        if (!ifMatchSatisfied(ifMatch, current)) {
          throw new AppError(412, 'precondition_failed', 'The resource was modified since you read it (If-Match does not match). Fetch it again and retry.');
        }
        return r.handler(make(tx));
      });
    } else {
      out = await r.handler(make());
    }

    if (out.send) {
      await out.send(res);
      return;
    }
    for (const [k, val] of Object.entries(out.headers ?? {})) res.setHeader(k, val);
    const status = out.status ?? r.success.status;
    if (storeKey && status < 300) {
      idem.set(storeKey, { fingerprint: (res.locals as any).idemFp, status, body: out.body, headers: out.headers ?? {} });
    }
    res.status(status).json(out.body);
  };

  for (const r of routes) router[r.method](toExpress(r.path), handle(r));
  router.use((_req, _res, next) => next(notFound('Endpoint')));
  return router;
}
