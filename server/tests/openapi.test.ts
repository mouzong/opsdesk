import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';
import { coverageMarkdown, API_ONLY, UI_COVERAGE } from '../api/coverage.js';
import { createApiRouter } from '../api/mount.js';
import { buildOpenApi } from '../api/openapi.js';
import { routes } from '../api/routes.js';
import { createHealthService } from '../health.js';
import { cleanup, newContext } from './helpers.js';

const spec = buildOpenApi();
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

describe('OpenAPI document', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(JSON.parse(JSON.stringify(spec)));
    expect(result.errors ?? null, JSON.stringify(result.errors)).toBeFalsy();
    expect(result.valid).toBe(true);
  });

  it('describes exactly the routes the server mounts (no drift, no undocumented endpoints)', async () => {
    const { ctx, dataDir } = await newContext({ name: 'sqlite' });
    const router = createApiRouter(ctx, { health: createHealthService(ctx, { timeoutMs: 1000, cacheMs: 0 }) });
    const mounted = new Set<string>();
    for (const layer of (router as any).stack) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) mounted.add(`${m.toUpperCase()} ${layer.route.path.replace(/:(\w+)/g, '{$1}')}`);
    }
    const documented = new Set<string>();
    for (const [path, item] of Object.entries<any>(spec.paths)) for (const m of Object.keys(item)) documented.add(`${m.toUpperCase()} ${path}`);
    expect([...mounted].sort()).toEqual([...documented].sort());
    await ctx.closeDb();
    cleanup(dataDir);
  });

  it('is internally consistent: unique operationIds, tags, security, parameters, references, error responses', () => {
    const ids = new Set<string>();
    const tagNames = new Set(spec.tags.map((t: any) => t.name));
    const refs: string[] = [];
    const walk = (o: any) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === '$ref') refs.push(String(v)); else walk(v); } };
    walk(spec);
    for (const [path, item] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(item)) {
        expect(ids.has(op.operationId), `duplicate ${op.operationId}`).toBe(false);
        ids.add(op.operationId);
        expect(op.summary, op.operationId).toBeTruthy();
        expect(op.tags.every((t: string) => tagNames.has(t))).toBe(true);
        expect(op.security, op.operationId).toBeDefined();
        const declared = new Set((op.parameters ?? []).filter((p: any) => p.in === 'path').map((p: any) => p.name));
        for (const m of path.matchAll(/\{(\w+)\}/g)) expect(declared.has(m[1]), `${op.operationId} path param ${m[1]}`).toBe(true);
        expect(op.responses['500'], op.operationId).toBeDefined();
        const successCodes = Object.keys(op.responses).filter((c) => c.startsWith('2'));
        expect(successCodes.length, op.operationId).toBe(1);
        if (method === 'get') expect(op.requestBody).toBeUndefined();
      }
    }
    for (const ref of refs) {
      const target = ref.replace('#/', '').split('/').reduce<any>((o, k) => o?.[k], spec);
      expect(target, `unresolved ${ref}`).toBeDefined();
    }
  });

  it('authentication per operation: public / read (anonymous or bearer) / write (bearer only)', () => {
    for (const r of routes) {
      const op = (spec.paths as any)[r.path][r.method];
      if (r.access === 'public') expect(op.security).toEqual([]);
      else if (r.access === 'read') { expect(r.method).toBe('get'); expect(op.security).toEqual([{}, { bearerAuth: [] }]); }
      else { expect(r.method).not.toBe('get'); expect(op.security).toEqual([{ bearerAuth: [] }]); }
      expect(op.description, r.operationId).toMatch(/\*\*Authentication:\*\*/);
      expect(op['x-idempotency'], r.operationId).toBeTruthy();
      if (r.method !== 'get') expect(r.access).toBe('write');
    }
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('destructive operations are marked and documented with their confirmation requirement', () => {
    const destructive = routes.filter((r) => r.destructive).map((r) => r.operationId).sort();
    expect(destructive).toEqual(['applyImport', 'clearRecent', 'deleteBackup', 'deleteBookmark', 'deleteGroup', 'deleteWorkspace', 'removeSampleData', 'restoreBackup']);
    for (const r of routes) {
      const op = (spec.paths as any)[r.path][r.method];
      expect(Boolean(op['x-destructive'])).toBe(Boolean(r.destructive));
      if (r.destructive) expect(op.summary.startsWith('⚠')).toBe(true);
    }
    const apply = (spec.paths as any)['/import/apply'].post;
    expect(apply.description).toMatch(/confirmReplace/);
    expect((spec.paths as any)['/backups/{name}/restore'].post.description).toMatch(/confirm/);
    expect((spec.paths as any)['/workspaces/{id}'].delete.description).toMatch(/mode/);
  });

  it('documents multipart uploads, file downloads, pagination, filters and examples', () => {
    const preview = (spec.paths as any)['/import/preview'].post;
    expect(Object.keys(preview.requestBody.content).sort()).toEqual(['application/json', 'multipart/form-data']);
    expect(preview.requestBody.content['multipart/form-data'].schema.properties.file.format).toBe('binary');
    expect(Object.keys(preview.requestBody.content['application/json'].examples).length).toBeGreaterThan(1);
    expect((spec.paths as any)['/export'].get.responses['200'].headers['Content-Disposition']).toBeDefined();
    expect((spec.paths as any)['/backups/{name}/download'].get.responses['200'].content['application/vnd.sqlite3'].schema.format).toBe('binary');
    const params = Object.fromEntries((spec.paths as any)['/bookmarks'].get.parameters.map((p: any) => [p.name, p]));
    for (const n of ['q', 'workspaceId', 'groupId', 'environment', 'tag', 'favorite', 'sort', 'order', 'limit', 'offset']) expect(params[n], n).toBeDefined();
    expect(params.limit.schema).toMatchObject({ minimum: 1, maximum: 200, default: 50 });
    expect(params.sort.schema.enum).toContain('lastOpenedAt');
    const create = (spec.paths as any)['/groups/{id}/bookmarks'].post.requestBody.content['application/json'].schema;
    expect(create.required).toEqual(expect.arrayContaining(['title', 'url']));
    expect(create.properties.title).toMatchObject({ minLength: 1, maxLength: 120 });
    expect(create.properties.environment.enum).toContain('production');
    expect(create.properties.url).toMatchObject({ format: 'uri', maxLength: 2048 });
    expect(spec.components.schemas.BookmarkItemPage.properties.page).toBeDefined();
    expect(spec.tags.map((t: any) => t.name)).toEqual(expect.arrayContaining(['Workspaces', 'Groups', 'Bookmarks', 'Import and export', 'Backups']));
  });

  it('examples use reserved example domains and fake identifiers only; no secrets', () => {
    const text = JSON.stringify(spec);
    for (const m of text.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) {
      const host = m[1]!;
      expect(/(^|\.)example\.(org|com|net)$|^127\.0\.0\.1$|^localhost$|^json-schema\.org$|^spec\.openapis\.org$/.test(host), `host ${host}`).toBe(true);
    }
    expect(text).not.toMatch(/[0-9a-f]{40,}/i);
    expect(text).not.toMatch(/Bearer [A-Za-z0-9._~+/=-]{20,}/);
    expect(text).not.toMatch(/OPSDESK_API_TOKEN=[A-Za-z0-9]{10,}/);
  });
});

describe('committed documentation artifacts are generated from the code', () => {
  it('docs/api/openapi.json equals the generated contract (run `npm run api:spec` when this fails)', () => {
    expect(JSON.parse(readFileSync(resolve('docs/api/openapi.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(spec)));
  });
  it('docs/api/coverage.md equals the generated coverage table', () => {
    expect(readFileSync(resolve('docs/api/coverage.md'), 'utf8')).toBe(coverageMarkdown());
  });
  it('every UI operation maps to existing endpoints, and every endpoint is accounted for', () => {
    const ids = new Set(routes.map((r) => r.operationId));
    const mapped = new Set<string>();
    for (const c of [...UI_COVERAGE, ...API_ONLY]) for (const id of c.operationIds) { expect(ids.has(id), `unknown ${id}`).toBe(true); mapped.add(id); }
    expect(routes.map((r) => r.operationId).filter((id) => !mapped.has(id))).toEqual([]);
    expect(coverageMarkdown()).not.toContain('MISSING');
  });
});

describe('Swagger UI assets are bundled and configured safely', () => {
  const dir = resolve('docs/assets/swagger');
  it('vendored files are present and identical to the installed swagger-ui-dist', () => {
    for (const f of ['swagger-ui-bundle.js', 'swagger-ui.css', 'LICENSE', 'NOTICE', 'loader.js', 'overrides.css']) expect(existsSync(resolve(dir, f)), f).toBe(true);
    const src = resolve('node_modules/swagger-ui-dist');
    if (existsSync(src)) for (const f of ['swagger-ui-bundle.js', 'swagger-ui.css']) expect(sha(resolve(dir, f)), f).toBe(sha(resolve(src, f)));
  });
  it('the loader disables persistence, auto-execution and the external validator, and loads nothing remote', () => {
    const source = readFileSync(resolve(dir, 'loader.js'), 'utf8');
    const js = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, ''); // code only, comments removed
    expect(js).toMatch(/persistAuthorization:\s*false/);
    expect(js).toMatch(/tryItOutEnabled:\s*false/);
    expect(js).toMatch(/validatorUrl:\s*null/);
    expect(js).toMatch(/credentials\s*=\s*'omit'/);
    expect(js).not.toMatch(/localStorage|sessionStorage|preauthorize|OPSDESK_API_TOKEN\s*[:=]\s*['"]/);
    expect(js).not.toMatch(/https:\/\/(?!github)/); // no external https origins
    expect(js).toMatch(/document\$/); // instant-navigation aware
  });
});
