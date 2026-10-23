import { z } from 'zod';
import { LIMITS } from '../../shared/constants.js';
import { VERSION } from '../version.js';
import { components } from './schemas.js';
import { routes } from './routes.js';
import type { RouteDef } from './registry.js';

const strip = (s: any): any => {
  if (Array.isArray(s)) return s.map(strip);
  if (s && typeof s === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(s)) if (k !== '$schema' && k !== '$id') out[k] = strip(v);
    return out;
  }
  return s;
};
const jsonSchema = (schema: z.ZodType, io: 'input' | 'output' = 'input') => strip(z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'draft-2020-12' }));
const refOf = (id: string) => ({ $ref: `#/components/schemas/${id}` });

const TAGS: [string, string][] = [
  ['System', 'Health, version, capabilities and this specification. No credentials needed.'],
  ['Settings', 'Server-side preferences and first-run setup.'],
  ['Workspaces', 'Top-level containers. List, read, create, edit, delete (with move-or-delete semantics) and reorder.'],
  ['Groups', 'Sections inside a workspace. CRUD, reorder and move between workspaces.'],
  ['Bookmarks', 'Bookmark cards. CRUD, duplicate, move/reorder, pin/unpin (the `favorite` field).'],
  ['Search and metadata', 'Environment values and tags (derived from bookmarks).'],
  ['Recent', 'Recently opened history: list, record an opening, clear.'],
  ['Import and export', 'Portable JSON export; JSON / browser-HTML import with preview, merge and protected replace.'],
  ['Backups', 'SQLite database backups (not available on PostgreSQL/MySQL).'],
  ['UI internals', 'Used by the bundled web UI; kept for compatibility. Not part of the CLI contract.'],
];

const ERROR_DOCS: Record<number, [string, string, string]> = {
  400: ['BadRequest', 'Invalid request: validation failed or a required confirmation is missing. `error.fields` lists field messages.', 'validation_error'],
  401: ['Unauthorized', 'Authentication required or the bearer token is invalid.', 'authentication_required'],
  403: ['Forbidden', 'The request is not allowed (host, origin, CSRF, HTTPS requirement).', 'bad_origin'],
  404: ['NotFound', 'The resource or endpoint does not exist.', 'not_found'],
  405: ['MethodNotAllowed', 'Method or CORS pre-flight not allowed.', 'method_not_allowed'],
  409: ['Conflict', 'The request conflicts with the current state (for example a non-empty group without `mode`, setup already done, backups not supported on this engine).', 'conflict'],
  412: ['PreconditionFailed', 'The `If-Match` validator no longer matches: the resource changed since you read it. Fetch it again.', 'precondition_failed'],
  413: ['PayloadTooLarge', 'The request body or uploaded file is too large.', 'too_large'],
  415: ['UnsupportedMediaType', 'Unsupported Content-Type.', 'unsupported_media_type'],
  422: ['UnprocessableEntity', 'The Idempotency-Key was already used with a different request.', 'idempotency_key_reuse'],
  429: ['TooManyRequests', 'Too many failed authentication attempts. See Retry-After.', 'too_many_requests'],
  500: ['InternalError', 'Unexpected server error (details are never exposed; quote the request id).', 'internal'],
  503: ['ServiceUnavailable', 'Health status is red.', 'unavailable'],
};

function authText(r: RouteDef): string {
  if (r.access === 'public') return '**Authentication:** none.';
  if (r.access === 'read') return '**Authentication:** none on localhost (same trust as the web UI). A bearer token is accepted, and required for browser calls from another origin.';
  return '**Authentication:** required - `Authorization: Bearer <token>` (token configured on the server as `OPSDESK_API_TOKEN`). The bundled web UI authenticates with its same-origin session instead.';
}

function operation(r: RouteDef) {
  const parameters: any[] = [];
  const pathParams = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
  const ps = r.params ? jsonSchema(r.params) : { properties: {} as any };
  for (const name of pathParams) {
    const sch = ps.properties?.[name] ?? { type: 'string' };
    const { description, ...rest } = sch;
    parameters.push({ name, in: 'path', required: true, ...(description ? { description } : {}), schema: rest });
  }
  if (r.query) {
    const qs = jsonSchema(r.query);
    for (const [name, sch] of Object.entries<any>(qs.properties ?? {})) {
      const { description, ...rest } = sch;
      parameters.push({ name, in: 'query', required: (qs.required ?? []).includes(name), ...(description ? { description } : {}), schema: rest });
    }
  }
  if (r.conditional) parameters.push({ name: 'If-Match', in: 'header', required: false, description: 'ETag from a previous GET. If the resource changed since, the request fails with 412 and nothing is modified.', schema: { type: 'string' }, example: 'W/"1a2b3c4d5e6f7a8b9c0d"' });
  if (r.idempotencyKey) parameters.push({ name: 'Idempotency-Key', in: 'header', required: false, description: 'Unique key (8-128 chars of A-Z a-z 0-9 . _ : -). A retry with the same key and body replays the first response instead of repeating the operation (kept 24 h, in memory).', schema: { type: 'string', minLength: 8, maxLength: 128 }, example: 'create-ws-2026-10-22-0001' });

  const description = [r.description, authText(r), `**Idempotency:** ${r.idempotency === 'safe' ? 'safe (never changes data)' : r.idempotency === 'idempotent' ? 'idempotent (repeating it has the same effect as once)' : 'not idempotent' + (r.idempotencyKey ? ' - send an Idempotency-Key to retry safely' : '')}.`].filter(Boolean).join('\n\n');

  const op: any = {
    operationId: r.operationId, tags: [r.tag],
    summary: r.destructive ? `⚠ ${r.summary}` : r.summary, description,
    security: r.access === 'public' ? [] : r.access === 'read' ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }],
    'x-idempotency': r.idempotency,
    ...(r.destructive ? { 'x-destructive': true } : {}),
    ...(r.internal ? { 'x-internal': true } : {}),
    ...(parameters.length ? { parameters } : {}),
  };

  if (r.body || r.multipart) {
    const content: any = {};
    if (r.body) {
      content['application/json'] = {
        schema: jsonSchema(r.body),
        ...(r.bodyExamples ? { examples: r.bodyExamples } : {}),
      };
    }
    if (r.multipart) content['multipart/form-data'] = { schema: r.multipart };
    op.requestBody = { required: r.bodyRequired === true, ...(r.bodyDescription ? { description: r.bodyDescription } : {}), content };
  }

  const responses: any = {};
  const s = r.success;
  const ct = s.response.contentType ?? 'application/json';
  responses[String(s.status)] = {
    description: s.response.description,
    headers: { 'X-Request-Id': { $ref: '#/components/headers/XRequestId' }, ...(s.response.headers ?? {}) },
    ...(s.response.schema ? { content: { [ct]: { schema: typeof s.response.schema === 'string' ? refOf(s.response.schema) : s.response.schema } } } : {}),
  };
  const codes = new Set<number>([...(r.errors ?? []), 500]);
  if (r.access === 'write') { codes.add(401); codes.add(403); codes.add(429); }
  if (r.access === 'read') codes.add(403);
  if (r.params && r.access !== 'public') codes.add(400);
  for (const c of [...codes].sort((a, b) => a - b)) responses[String(c)] = { $ref: `#/components/responses/${ERROR_DOCS[c]![0]}` };
  op.responses = responses;
  return op;
}

/** The single authoritative OpenAPI 3.1 contract, generated from the executed route definitions and validators. */
export function buildOpenApi(): Record<string, any> {
  const generated = z.toJSONSchema(components, { io: 'output', unrepresentable: 'any', uri: (id) => `#/components/schemas/${id}`, target: 'draft-2020-12' }) as any;
  const schemas: Record<string, any> = {};
  for (const [id, s] of Object.entries<any>(generated.schemas)) schemas[id] = strip(s);

  const errorResponses: Record<string, any> = {};
  for (const [code, [name, description, errCode]] of Object.entries(ERROR_DOCS)) {
    errorResponses[name] = {
      description,
      headers: { 'X-Request-Id': { $ref: '#/components/headers/XRequestId' } },
      content: { 'application/json': { schema: refOf('ApiError'), example: { error: { code: errCode, message: description.split('.')[0], requestId: '5b0f2a1e-0000-4000-8000-00000000abcd' } } } },
    };
  }

  const paths: Record<string, any> = {};
  for (const r of routes) (paths[r.path] ??= {})[r.method] = operation(r);

  return {
    openapi: '3.1.0',
    info: {
      title: 'OpsDesk HTTP API',
      version: VERSION,
      summary: 'Everything the OpsDesk UI can do, for curl and scripts.',
      description:
        'Local, single-user API of the OpsDesk bookmarks dashboard.\n\n' +
        '**Versioning:** the stable contract lives under `/api/v1`. The unversioned `/api` prefix is an alias of the current version used by the bundled UI. Within `v1` changes are backwards compatible (new endpoints, optional fields, new enum values on responses); anything breaking would appear as `/api/v2`.\n\n' +
        '**Authentication:** `Authorization: Bearer <token>`, token configured on the server (`OPSDESK_API_TOKEN`). Changing data without a valid token is refused. Reads are anonymous on localhost.\n\n' +
        '**Out of scope on purpose (not available through this API):** selecting the database engine, database credentials, the API token itself, file-system paths, process control, arbitrary SQL, and any deployment setting.',
      license: { name: 'Proprietary', identifier: 'LicenseRef-OpsDesk' },
    },
    servers: [{ url: '/api/v1', description: 'This OpsDesk server (relative to the address you reached the API on)' }],
    tags: TAGS.map(([name, description]) => ({ name, description })),
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'The server-side API token (OPSDESK_API_TOKEN). Treat it like a password; never put it in URLs.' },
      },
      headers: { XRequestId: { description: 'Request correlation id (also in error bodies and the server log). You may supply your own 8-64 character `X-Request-Id`.', schema: { type: 'string' } } },
      schemas,
      responses: errorResponses,
    },
    'x-limits': { pageSizeMax: 200, importBytes: LIMITS.importBytes },
  };
}
