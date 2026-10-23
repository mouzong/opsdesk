import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, parseCorsOrigins } from '../config.js';
import { TOKEN } from './contract.js';
import { cleanup, startServer, tempDir, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (servers.length) {
    const s = servers.pop()!;
    await s.close();
    cleanup(s.dataDir);
  }
});
const boot = async (config: Parameters<typeof startServer>[0] extends infer T ? (T extends { config?: infer C } ? C : never) : never = {}, app = {}) => {
  const s = await startServer({ config, app: { quiet: true, ...app } });
  servers.push(s);
  return s;
};
const json = { 'Content-Type': 'application/json' };
const bearer = { Authorization: `Bearer ${TOKEN}` };

/** Raw HTTP so we can control the Host header (fetch forbids it). */
function raw(port: number, method: string, path: string, headers: Record<string, string>, body?: string): Promise<{ status: number; headers: Record<string, any>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('API authentication: token NOT configured', () => {
  it('reads work; every change from a non-browser client is refused; bearer cannot be used', async () => {
    const s = await boot();
    expect((await fetch(`${s.base}/api/v1/workspaces`)).status).toBe(200);
    expect((await fetch(`${s.base}/api/v1/health`)).status).toBe(200);
    for (const [m, p] of [['POST', '/workspaces'], ['PATCH', '/settings'], ['DELETE', '/recent'], ['POST', '/import/apply']] as const) {
      const r = await fetch(`${s.base}/api/v1${p}`, { method: m, headers: json, body: m === 'DELETE' ? undefined : '{"name":"x","title":"x"}' });
      expect(r.status, `${m} ${p}`).toBe(401);
      expect(((await r.json()) as any).error.code).toBe('authentication_required');
      expect(r.headers.get('www-authenticate')).toMatch(/^Bearer/);
    }
    const withBearer = await fetch(`${s.base}/api/v1/workspaces`, { method: 'POST', headers: { ...json, ...bearer }, body: '{"name":"x"}' });
    expect(withBearer.status).toBe(401);
    expect(((await withBearer.json()) as any).error.code).toBe('api_auth_not_configured');
    expect(((await (await fetch(`${s.base}/api/v1/capabilities`)).json()) as any).authentication.bearerToken).toBe(false);
    expect(((await s.api('GET', '/dashboard')).body.workspaces)).toHaveLength(0);
  });

  it('the UI session path is unchanged: same-origin + JSON + CSRF works; missing Origin or token does not', async () => {
    const s = await boot();
    expect((await s.api('POST', '/workspaces', { name: 'ui' })).status).toBe(201);
    const noOrigin = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...json, 'X-CSRF-Token': s.csrf }, body: '{"name":"curl-forged"}' });
    expect(noOrigin.status).toBe(401); // a curl client cannot just reuse the CSRF token
    const noCsrf = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...json, Origin: s.base }, body: '{"name":"x"}' });
    expect(noCsrf.status).toBe(401); // same-origin page without a token and without the UI's CSRF header (e.g. Swagger "Try it out")
    expect(((await noCsrf.json()) as any).error.code).toBe('authentication_required');
    const badCsrf = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...json, Origin: s.base, 'X-CSRF-Token': 'wrong' }, body: '{"name":"x"}' });
    expect(badCsrf.status).toBe(403);
    const form = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: s.base, 'X-CSRF-Token': s.csrf }, body: '{"name":"x"}' });
    expect(form.status).toBe(415);
    const foreign = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...json, Origin: 'https://evil.example.com', 'X-CSRF-Token': s.csrf }, body: '{"name":"x"}' });
    expect(foreign.status).toBe(403);
    expect((await s.api('GET', '/dashboard')).body.workspaces).toHaveLength(1);
  });
});

describe('API authentication: token configured', () => {
  it('rejects missing/wrong/malformed credentials and accepts the right token without Origin or CSRF', async () => {
    const s = await boot({ apiToken: TOKEN });
    const post = (headers: Record<string, string>) => fetch(`${s.base}/api/v1/workspaces`, { method: 'POST', headers: { ...json, ...headers }, body: '{"name":"A"}' });
    expect((await post({})).status).toBe(401);
    const wrong = await post({ Authorization: `Bearer ${TOKEN}x` });
    expect(wrong.status).toBe(401);
    expect(((await wrong.json()) as any).error.code).toBe('invalid_token');
    expect(wrong.headers.get('www-authenticate')).toContain('invalid_token');
    const basic = await post({ Authorization: 'Basic dXNlcjpwdw==' });
    expect(((await basic.json()) as any).error.code).toBe('invalid_authorization');
    const ok = await post(bearer);
    expect(ok.status).toBe(201);
    // DELETE without any Content-Type, and a POST without a body
    const id = ((await ok.json()) as any).id;
    expect((await fetch(`${s.base}/api/v1/workspaces/${id}/groups`, { method: 'POST', headers: { ...bearer, 'Content-Type': 'application/json' }, body: '{"name":"G"}' })).status).toBe(201);
    expect((await fetch(`${s.base}/api/v1/workspaces/${id}?mode=delete`, { method: 'DELETE', headers: bearer })).status).toBe(200);
    // bearer is also accepted on reads
    expect((await fetch(`${s.base}/api/v1/workspaces`, { headers: bearer })).status).toBe(200);
  });

  it('browser Origin rules: same origin ok, foreign origin refused, only EXACT configured origins are allowed (CORS, no wildcard)', async () => {
    const s = await boot({ apiToken: TOKEN, corsOrigins: ['http://127.0.0.1:8765'] });
    const call = (origin: string | null, extra: Record<string, string> = {}, method = 'POST') =>
      fetch(`${s.base}/api/v1/workspaces`, { method, headers: { ...json, ...bearer, ...(origin ? { Origin: origin } : {}), ...extra }, ...(method === 'POST' ? { body: '{"name":"o"}' } : {}) });
    expect((await call(s.base)).status).toBe(201);
    const foreign = await call('https://evil.example.com');
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    const similar = await call('http://127.0.0.1:8766');
    expect(similar.status).toBe(403);
    const allowed = await call('http://127.0.0.1:8765');
    expect(allowed.status).toBe(201);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8765');
    expect(allowed.headers.get('access-control-allow-origin')).not.toBe('*');
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull();
    // pre-flight
    const pre = await fetch(`${s.base}/api/v1/workspaces`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8765', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8765');
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
    const preBad = await fetch(`${s.base}/api/v1/workspaces`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'POST' } });
    expect(preBad.status).toBe(405);
    expect(preBad.headers.get('access-control-allow-origin')).toBeNull();
    // the allowed origin still needs the token; anonymous cross-origin reads are refused
    const anon = await fetch(`${s.base}/api/v1/workspaces`, { headers: { Origin: 'http://127.0.0.1:8765' } });
    expect(anon.status).toBe(403);
    expect(((await anon.json()) as any).error.code).toBe('cross_origin_requires_token');
    expect((await fetch(`${s.base}/api/v1/workspaces`, { headers: { ...bearer, Origin: 'http://127.0.0.1:8765' } })).status).toBe(200);
    // Sec-Fetch-Site cross-site without a token is refused (browser CSRF)
    expect((await fetch(`${s.base}/api/v1/workspaces`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
  });

  it('Host allow-list applies to token clients (DNS rebinding); HTTPS is required for non-local host names', async () => {
    const s = await boot({ apiToken: TOKEN, allowedHosts: ['api.example.test'] });
    const evil = await raw(s.port, 'GET', '/api/v1/workspaces', { Host: 'evil.example.com', ...bearer });
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.body).error.code).toBe('host_not_allowed');
    // an allowed non-local name over plain HTTP: the token must not be accepted
    const plain = await raw(s.port, 'GET', '/api/v1/workspaces', { Host: 'api.example.test', ...bearer });
    expect(plain.status).toBe(403);
    expect(JSON.parse(plain.body).error.code).toBe('https_required');
    // X-Forwarded-Proto is ignored unless the proxy is trusted
    const spoof = await raw(s.port, 'GET', '/api/v1/workspaces', { Host: 'api.example.test', 'X-Forwarded-Proto': 'https', ...bearer });
    expect(spoof.status).toBe(403);
    // localhost names keep working over HTTP
    expect((await raw(s.port, 'GET', '/api/v1/workspaces', { Host: `localhost:${s.port}`, ...bearer })).status).toBe(200);

    const t = await boot({ apiToken: TOKEN, allowedHosts: ['api.example.test'], trustProxy: true });
    const ok = await raw(t.port, 'GET', '/api/v1/workspaces', { Host: 'api.example.test', 'X-Forwarded-Proto': 'https', ...bearer });
    expect(ok.status).toBe(200);
    const http = await raw(t.port, 'GET', '/api/v1/workspaces', { Host: 'api.example.test', 'X-Forwarded-Proto': 'http', ...bearer });
    expect(http.status).toBe(403);
  });

  it('brute-force protection: repeated wrong tokens are throttled', async () => {
    const s = await boot({ apiToken: TOKEN });
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await fetch(`${s.base}/api/v1/workspaces`, { headers: { Authorization: 'Bearer wrong-' + i } })).status;
    expect(last).toBe(401);
    const blocked = await fetch(`${s.base}/api/v1/workspaces`, { headers: bearer });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await fetch(`${s.base}/api/v1/health`)).status).toBe(200); // public endpoints stay available
  });

  it('the UI keeps working unchanged while a token is configured', async () => {
    const s = await boot({ apiToken: TOKEN });
    expect((await s.api('POST', '/workspaces', { name: 'ui' })).status).toBe(201);
    expect((await s.api('GET', '/dashboard')).body.workspaces).toHaveLength(1);
    // the token is not needed by (and never sent by) the UI; CSRF is still enforced for it
    const noCsrf = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...json, Origin: s.base, 'X-CSRF-Token': 'wrong' }, body: '{"name":"x"}' });
    expect(noCsrf.status).toBe(403);
  });
});

describe('the token never leaks', () => {
  it('is absent from every response body and header, and from the server log', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const s = await boot({ apiToken: TOKEN }, { quiet: false });
    const texts: string[] = [];
    const grab = async (r: Response) => { texts.push(await r.text(), JSON.stringify([...r.headers.entries()])); };
    for (const p of ['/health', '/version', '/capabilities', '/session', '/openapi.json', '/dashboard', '/settings', '/export', '/workspaces/nope']) await grab(await fetch(`${s.base}/api/v1${p}`, { headers: bearer }));
    await grab(await fetch(`${s.base}/api/v1/workspaces`, { method: 'POST', headers: { ...json, Authorization: `Bearer ${TOKEN}x` }, body: '{}' })); // wrong token
    await grab(await fetch(`${s.base}/api/v1/workspaces`, { method: 'POST', headers: { ...json, ...bearer }, body: '{"name":""}' })); // validation error
    for (const t of texts) expect(t.includes(TOKEN)).toBe(false);
    const logged = [...log.mock.calls, ...err.mock.calls].flat().join('\n');
    expect(logged.length).toBeGreaterThan(0); // request log lines exist...
    expect(logged.includes(TOKEN)).toBe(false); // ...and contain no token
    expect(logged).not.toMatch(/Bearer/i);
    expect(logged).not.toMatch(/\?/); // no query strings
  });
});

describe('token and CORS configuration', () => {
  const cfg = (env: NodeJS.ProcessEnv) => { const d = tempDir(); try { return loadConfig({ OPSDESK_DATA_DIR: d, ...env }, d); } finally { cleanup(d); } };
  it('reads the token from OPSDESK_API_TOKEN or a file, validates it without echoing it, and keeps it out of serialisation', async () => {
    expect(cfg({ OPSDESK_API_TOKEN: TOKEN }).apiToken).toBe(TOKEN);
    expect(JSON.stringify(cfg({ OPSDESK_API_TOKEN: TOKEN }))).not.toContain(TOKEN);
    expect(cfg({}).apiToken).toBeUndefined();
    for (const bad of ['short', 'has spaces in the token value 123456', 'x'.repeat(300), 'bad<chars>bad<chars>bad<chars>bad']) {
      try { cfg({ OPSDESK_API_TOKEN: bad }); expect.unreachable(); } catch (e) { expect((e as Error).message).not.toContain(bad); expect((e as Error).message).toMatch(/OPSDESK_API_TOKEN/); }
    }
    const { writeFileSync } = await import('node:fs');
    const d = tempDir();
    writeFileSync(`${d}/tok`, TOKEN + '\n');
    expect(loadConfig({ OPSDESK_DATA_DIR: d, OPSDESK_API_TOKEN_FILE: `${d}/tok` }, d).apiToken).toBe(TOKEN);
    cleanup(d);
  });
  it('the JSON file cannot carry the token; CORS origins must be exact', () => {
    expect(() => { const d = tempDir(); require_write(d, { apiToken: TOKEN }); loadConfig({ OPSDESK_CONFIG: `${d}/c.json`, OPSDESK_DATA_DIR: d }, d); }).toThrowError(/invalid/);
    expect(parseCorsOrigins(['http://127.0.0.1:8000', 'HTTPS://Docs.Example.org'])).toEqual(['http://127.0.0.1:8000', 'https://docs.example.org']);
    for (const bad of ['*', 'http://*.example.org', 'http://example.org/path', 'ftp://example.org', 'example.org', 'http://user:pw@example.org']) {
      expect(() => parseCorsOrigins([bad]), bad).toThrowError(/OPSDESK_CORS_ORIGINS/);
    }
    expect(cfg({ OPSDESK_CORS_ORIGINS: 'http://127.0.0.1:8000, http://localhost:8000' }).corsOrigins).toEqual(['http://127.0.0.1:8000', 'http://localhost:8000']);
  });
});

function require_write(dir: string, obj: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = (globalThis as any).process.getBuiltinModule('node:fs');
  fs.writeFileSync(`${dir}/c.json`, JSON.stringify(obj));
}
