import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { buildOpenApi } from '../api/openapi.js';
import { routes } from '../api/routes.js';
import type { TestServer } from './helpers.js';

export const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';
export const spec = buildOpenApi();
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const cache = new Map<string, ValidateFunction>();

/** Validator for the documented response body of operation/status, falling back to the shared error schema for 4xx/5xx. */
function validatorFor(operationId: string, status: number): ValidateFunction | null {
  const key = `${operationId}:${status}`;
  if (cache.has(key)) return cache.get(key)!;
  const route = routes.find((r) => r.operationId === operationId)!;
  const op = Object.values<any>((spec.paths as any)[route.path]).find((o: any) => o.operationId === operationId);
  let schema: any = null;
  const doc = op.responses[String(status)];
  if (doc && !doc.$ref && doc.content?.['application/json']) schema = doc.content['application/json'].schema;
  else if (status >= 400 && !(operationId === 'getHealth' && status === 503)) schema = { $ref: '#/components/schemas/ApiError' };
  if (!schema) return null;
  const v = ajv.compile({ components: spec.components, ...schema });
  cache.set(key, v);
  return v;
}

export interface CallOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Send without the bearer token. */
  anonymous?: boolean;
  raw?: BodyInit;
  expect: number;
}

export const covered = new Set<string>();

/** Calls the API as a CLI client (bearer token, no Origin, no CSRF) and validates the response against the OpenAPI contract. */
export function client(s: TestServer, prefix = '/api/v1') {
  return async function call(operationId: string, method: string, path: string, o: CallOptions): Promise<{ status: number; body: any; headers: Headers; text: string }> {
    covered.add(operationId);
    const headers: Record<string, string> = { ...(o.anonymous ? {} : { Authorization: `Bearer ${TOKEN}` }), ...(o.headers ?? {}) };
    let body: BodyInit | undefined = o.raw;
    if (o.body !== undefined) {
      headers['Content-Type'] ??= 'application/json';
      body = JSON.stringify(o.body);
    }
    const res = await fetch(`${s.base}${prefix}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* download or empty */ }
    if (res.status !== o.expect) throw new Error(`${operationId}: expected ${o.expect}, got ${res.status}: ${text.slice(0, 300)}`);
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    if (isJson) {
      const v = validatorFor(operationId, res.status);
      if (v && !v(parsed)) throw new Error(`${operationId} ${res.status} violates the OpenAPI contract: ${JSON.stringify(v.errors?.slice(0, 3))}\nbody: ${text.slice(0, 400)}`);
    }
    expectHeader(res, 'x-request-id');
    return { status: res.status, body: parsed, headers: res.headers, text };
  };
}

function expectHeader(res: Response, name: string) {
  if (!res.headers.get(name)) throw new Error(`missing ${name} header`);
}
