import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildInfo, VERSION } from '../version.js';
import { cleanup, startServer, tempDir, type TestServer } from './helpers.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const servers: TestServer[] = [];
const dirs: string[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
  while (dirs.length) cleanup(dirs.pop()!);
});

function fakeDocs(): string {
  const dir = tempDir();
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'operations', 'health'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Docs home</title><script>window.x=1</script>');
  writeFileSync(join(dir, 'operations', 'health', 'index.html'), '<!doctype html><title>Health page</title>');
  writeFileSync(join(dir, 'assets', 'app.css'), 'body{}');
  return dir;
}

describe('release version', () => {
  it('is read from package.json and is identical in /api/session and /api/health', async () => {
    expect(VERSION).toBe(pkg.version);
    const s = await startServer();
    servers.push(s);
    dirs.push(s.dataDir);
    const session = (await s.api('GET', '/session')).body;
    const health = (await (await fetch(`${s.base}/api/health`)).json()) as { version: string };
    expect(session.version).toBe(pkg.version);
    expect(health.version).toBe(pkg.version);
  });

  it('build info: only genuine, matching metadata is returned', () => {
    const root = tempDir();
    dirs.push(root);
    const serverDir = join(root, 'dist', 'server');
    mkdirSync(serverDir, { recursive: true });
    const file = join(root, 'dist', 'build-info.json');
    expect(readBuildInfo(serverDir, '9.9.9')).toBeNull(); // no file: nothing is invented
    writeFileSync(file, JSON.stringify({ version: '9.9.9', builtAt: '2026-10-22T10:00:00.000Z', commit: 'abcdef123456' }));
    expect(readBuildInfo(serverDir, '9.9.9')).toEqual({ builtAt: '2026-10-22T10:00:00.000Z', commit: 'abcdef123456' });
    expect(readBuildInfo(serverDir, '1.0.0')).toBeNull(); // stale build of another version is ignored
    writeFileSync(file, JSON.stringify({ version: '9.9.9', builtAt: '2026-10-22T10:00:00.000Z' }));
    expect(readBuildInfo(serverDir, '9.9.9')).toEqual({ builtAt: '2026-10-22T10:00:00.000Z' }); // commit omitted when unknown
    writeFileSync(file, JSON.stringify({ version: '9.9.9', builtAt: 'not a date', commit: '<script>' }));
    expect(readBuildInfo(serverDir, '9.9.9')).toBeNull();
    writeFileSync(file, JSON.stringify({ version: '9.9.9', builtAt: '2026-10-22T10:00:00.000Z', commit: 'zz; rm -rf' }));
    expect(readBuildInfo(serverDir, '9.9.9')).toEqual({ builtAt: '2026-10-22T10:00:00.000Z' }); // malformed commit dropped
  });
});

describe('documentation under /docs/', () => {
  it('serves the index, nested pages (direct refresh), assets and redirects /docs; routing does not collide', async () => {
    const docsDir = fakeDocs();
    const s = await startServer({ app: { docsDir }, config: { serveWeb: false } });
    servers.push(s);
    dirs.push(s.dataDir);
    const index = await fetch(`${s.base}/docs/`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('Docs home');
    expect((await fetch(`${s.base}/docs/operations/health/`)).status).toBe(200);
    expect(await (await fetch(`${s.base}/docs/operations/health/`)).text()).toContain('Health page');
    expect((await fetch(`${s.base}/docs/assets/app.css`)).headers.get('content-type')).toMatch(/css/);
    const redirect = await fetch(`${s.base}/docs`, { redirect: 'manual' });
    expect([301, 302, 308]).toContain(redirect.status);
    expect(redirect.headers.get('location')).toBe('/docs/');
    expect((await fetch(`${s.base}/docs/does/not/exist/`)).status).toBe(404);
    expect((await fetch(`${s.base}/docs/../package.json`)).status).not.toBe(200);
    // API untouched
    expect((await fetch(`${s.base}/api/health`)).status).toBe(200);
    expect((await fetch(`${s.base}/api/nope`)).status).toBe(404);
  });

  it('docs get their own CSP (inline bootstrap allowed); the app keeps the strict one', async () => {
    const s = await startServer({ app: { docsDir: fakeDocs() } });
    servers.push(s);
    dirs.push(s.dataDir);
    const docsCsp = (await fetch(`${s.base}/docs/`)).headers.get('content-security-policy')!;
    expect(docsCsp).toContain("script-src 'self' 'unsafe-inline'");
    expect(docsCsp).toContain("default-src 'self'");
    expect(docsCsp).not.toMatch(/https?:\/\//); // no external origin allowed
    const apiCsp = (await fetch(`${s.base}/api/health`)).headers.get('content-security-policy')!;
    expect(apiCsp).toContain("script-src 'self';");
    expect(apiCsp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('answers with a helpful message when the documentation has not been built, and picks up a later build without restart', async () => {
    const empty = tempDir();
    dirs.push(empty);
    const s = await startServer({ app: { docsDir: join(empty, 'dist-docs') } });
    servers.push(s);
    dirs.push(s.dataDir);
    const res = await fetch(`${s.base}/docs/`);
    expect(res.status).toBe(404);
    expect(await res.text()).toMatch(/npm run docs:build/);
    mkdirSync(join(empty, 'dist-docs'), { recursive: true });
    writeFileSync(join(empty, 'dist-docs', 'index.html'), '<title>now built</title>');
    expect(await (await fetch(`${s.base}/docs/`)).text()).toContain('now built');
  });

  it('the single-page fallback still serves the app for client routes and never hijacks /docs or /api', async () => {
    const webDir = tempDir();
    dirs.push(webDir);
    writeFileSync(join(webDir, 'index.html'), '<title>SPA shell</title>');
    const s = await startServer({ app: { docsDir: join(webDir, 'nodocs'), webDir }, config: { serveWeb: true } });
    servers.push(s);
    dirs.push(s.dataDir);
    for (const path of ['/', '/settings', '/w/abc', '/some/unknown']) expect(await (await fetch(`${s.base}${path}`)).text(), path).toContain('SPA shell');
    expect(await (await fetch(`${s.base}/docs/x`)).text()).not.toContain('SPA shell');
    expect((await fetch(`${s.base}/api/unknown`)).headers.get('content-type')).toMatch(/json/);
  });
});
