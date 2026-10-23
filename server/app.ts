import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { createApiRouter } from './api/mount.js';
import { requestId } from './auth.js';
import type { AppContext } from './context.js';
import { AppError } from './errors.js';
import { createHealthService } from './health.js';
import type { ApplyHooks } from './importExport.js';
import { hostGuard, securityHeaders } from './security.js';

export interface AppOptions {
  quiet?: boolean;
  webDir?: string;
  /** Test seam only; never wired to HTTP input. */
  importHooks?: ApplyHooks;
  health?: { timeoutMs: number; cacheMs: number };
  /** Directory with the built documentation site (default: dist/docs). Served under /docs/. */
  docsDir?: string;
}

export function createApp(ctx: AppContext, options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('trust proxy', ctx.config.trustProxy ? 1 : false); // only then is X-Forwarded-Proto honoured (HTTPS check for bearer tokens)

  app.use(requestId());
  app.use(hostGuard(ctx));
  app.use(securityHeaders());

  if (!options.quiet) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        // Path only: never log query strings, bodies or bookmark data.
        console.log(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Date.now() - start}ms request=${res.locals.requestId}`);
      });
      next();
    });
  }

  const health = createHealthService(ctx, options.health ?? ctx.config.health);
  // One router, two prefixes: /api/v1 is the stable, documented contract; /api is its unversioned alias used by the bundled UI.
  const api = createApiRouter(ctx, { health, importHooks: options.importHooks });
  app.use('/api/v1', api);
  app.use('/api', api);

  /* documentation site (MkDocs build) under /docs/ - independent of the frontend router and of /api */
  // Compiled: dist/server -> dist/docs.  Dev (tsx): server -> dist/docs.  Never the Markdown sources in docs/.
  const here = import.meta.dirname;
  const docsDir = options.docsDir ?? (basename(dirname(here)) === 'dist' ? join(here, '..', 'docs') : join(here, '..', 'dist', 'docs'));
  const docsCsp =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  app.use('/docs', (_req, res, next) => {
    // MkDocs Material embeds a tiny inline bootstrap script (colour scheme); the relaxation applies to /docs only.
    res.setHeader('Content-Security-Policy', docsCsp);
    next();
  });
  app.use('/docs', express.static(docsDir, { index: 'index.html', redirect: true, maxAge: 0, fallthrough: true }));
  app.use('/docs', (_req, res) => {
    const built = existsSync(join(docsDir, 'index.html'));
    res.status(404).type('text/plain').send(
      built ? 'Documentation page not found. Go to /docs/ for the index.'
            : 'The documentation has not been built. Run "npm run docs:setup" once, then "npm run docs:build", and reload.',
    );
  });

  /* compiled frontend */
  if (ctx.config.serveWeb) {
    const webDir = options.webDir ?? resolve(import.meta.dirname, '..', 'web');
    const indexFile = join(webDir, 'index.html');
    if (existsSync(indexFile)) {
      app.use('/assets', express.static(join(webDir, 'assets'), { immutable: true, maxAge: '1y', index: false, fallthrough: false }));
      app.use(express.static(webDir, { index: false, maxAge: 0 }));
      app.get(/^\/(?!api(\/|$)|docs(\/|$)).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
      });
    } else {
      app.get('/', (_req, res) => {
        res.status(503).type('text/plain').send('OpsDesk: the frontend has not been built. Run "npm run build" and restart.');
      });
    }
  }

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    const rid = String(res.locals.requestId ?? '');
    const send = (status: number, code: string, message: string, fields?: Record<string, string>) =>
      res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}), requestId: rid } });
    if (err instanceof AppError) {
      send(err.status, err.code, err.message, err.fields);
      return;
    }
    const e = err as { status?: number; type?: string };
    if (e.type === 'entity.too.large') {
      send(413, 'too_large', 'The request is too large.');
      return;
    }
    if (e.type === 'entity.parse.failed' || e.status === 400) {
      send(400, 'bad_json', 'The request body is not valid JSON.');
      return;
    }
    if (typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      send(e.status, 'bad_request', 'The request could not be processed.');
      return;
    }
    // Never log request data, headers or tokens; the error name, path and request id are enough to start debugging.
    if (!options.quiet) console.error(`[error] ${req.method} ${req.originalUrl.split('?')[0]} ${(err as Error)?.name ?? 'Error'} request=${rid}`);
    if (process.env.OPSDESK_DEBUG === '1') console.error(err);
    send(500, 'internal', 'An unexpected error occurred.');
  };
  app.use(onError);
  return app;
}
