import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import type { Database } from '../db/types.js';
import { createHealthService } from '../health.js';
import { cleanup, ENGINES, startServer, tempDir, type TestServer } from './helpers.js';

const pkgVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

for (const engine of ENGINES) describe(`/api/health [${engine.name}]`, () => {
  const servers: TestServer[] = [];
  const dirs: string[] = [];
  const boot = async (opts: Parameters<typeof startServer>[0] = {}) => {
    const s = await startServer({ engine, ...opts });
    servers.push(s);
    dirs.push(s.dataDir);
    return s;
  };
  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
    while (dirs.length) cleanup(dirs.pop()!);
  });
  const get = async (s: TestServer) => {
    const r = await fetch(`${s.base}/api/health`);
    return { status: r.status, body: (await r.json()) as any };
  };

  it('green: 200 with the documented structure, real version and engine', async () => {
    const s = await boot();
    const { status, body } = await get(s);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      application_name: 'opsdesk', status: 'green', timed_out: false, version: pkgVersion, cached: false,
      checks: {
        database: { status: 'green', type: engine.name === 'postgres' ? 'postgresql' : engine.name, readable: true, writable: true },
        storage: { status: 'green', backup_directory_writable: true, data_directory_writable: engine.name === 'sqlite' ? true : 'not_applicable' },
        migrations: { status: 'green', current_version: '2', latest_version: '2', pending: 0 },
      },
    });
    expect(body.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(Number.isInteger(body.uptime_in_seconds)).toBe(true);
    expect(typeof body.response_time_ms).toBe('number');
    expect(body.checks.database.response_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('the write probe leaves no data behind and does not touch user tables', async () => {
    const s = await boot();
    await s.api('POST', '/setup', { choice: 'sample' });
    const before = await s.ctx.db.query('SELECT (SELECT COUNT(*) FROM bookmarks) AS b, (SELECT COUNT(*) FROM workspaces) AS w, (SELECT COUNT(*) FROM meta) AS m');
    for (let i = 0; i < 3; i++) expect((await get(s)).status).toBe(200);
    const after = await s.ctx.db.query('SELECT (SELECT COUNT(*) FROM bookmarks) AS b, (SELECT COUNT(*) FROM workspaces) AS w, (SELECT COUNT(*) FROM meta) AS m');
    expect(after).toEqual(before);
    expect(Number((await s.ctx.db.query('SELECT COUNT(*) AS n FROM health_probe'))[0]!.n)).toBe(0);
  });

  it('never exposes paths, credentials, connection strings or raw errors', async () => {
    const s = await boot();
    const text = await (await fetch(`${s.base}/api/health`)).text();
    for (const secret of [s.dataDir, 'tmp', 'opsdesk-test', 'password', 'testpw', 'postgres://', 'mysql://', '127.0.0.1', 'node_modules', 'Error:', ' at ']) {
      expect(text.includes(secret), secret).toBe(false);
    }
    await s.ctx.closeDb();
    const broken = await (await fetch(`${s.base}/api/health`)).text();
    for (const secret of [s.dataDir, 'testpw', 'Error:', 'closed', 'stack']) expect(broken.includes(secret), secret).toBe(false);
  });

  it('yellow: backup folder not writable -> 200, core features keep working', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'backups'), 'a file where the backup directory should be');
    const s = await boot({ dataDir: dir, reset: true });
    const { status, body } = await get(s);
    expect(status).toBe(200);
    expect(body.status).toBe('yellow');
    expect(body.checks.storage).toMatchObject({ status: 'yellow', backup_directory_writable: false, error: 'not_writable' });
    expect(body.checks.database.status).toBe('green');
    expect((await s.api('POST', '/workspaces', { name: 'still works' })).status).toBe(201);
  });

  it('red: write probe failing (read-only style failure) -> 503 write_failed', async () => {
    const s = await boot();
    await s.ctx.db.exec('DROP TABLE health_probe');
    const { status, body } = await get(s);
    expect(status).toBe(503);
    expect(body.status).toBe('red');
    expect(body.checks.database).toMatchObject({ status: 'red', readable: true, writable: false, error: 'write_failed' });
  });

  it('red: pending migrations -> 503', async () => {
    const s = await boot();
    await s.ctx.db.run('DELETE FROM schema_migrations WHERE version = 2');
    const { status, body } = await get(s);
    expect(status).toBe(503);
    expect(body.checks.migrations).toMatchObject({ status: 'red', current_version: '1', latest_version: '2', pending: 1, error: 'migrations_pending' });
  });

  it('red: database unavailable -> 503 and recovery after reopening', async () => {
    const s = await boot();
    await s.ctx.closeDb();
    const down = await get(s);
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ status: 'red', timed_out: false });
    expect(down.body.checks.database).toMatchObject({ status: 'red', readable: false, writable: false, error: 'read_failed' });
    expect(down.body.checks.migrations.error).toBe('unavailable');
    await s.ctx.reopenDb();
    expect((await get(s)).status).toBe(200);
  });

  it('timeout: a hanging database is reported as timed_out within the bound (503)', async () => {
    const s = await boot();
    const hanging: Database = {
      dialect: s.ctx.engine, query: () => new Promise(() => undefined), run: () => new Promise(() => undefined),
      exec: () => new Promise(() => undefined), transaction: () => new Promise(() => undefined), close: async () => undefined,
    };
    const fake = Object.create(s.ctx, { db: { get: () => hanging } }) as AppContext;
    const svc = createHealthService(fake, { timeoutMs: 200, cacheMs: 0 });
    const t0 = Date.now();
    const { statusCode, body } = await svc.run();
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(statusCode).toBe(503);
    expect(body.status).toBe('red');
    expect(body.timed_out).toBe(true);
    expect(body.checks.database.error).toBe('timeout');
    expect(body.checks.migrations.error).toBe('timeout');
    expect(JSON.stringify(body)).not.toMatch(/Error|stack/);
  });

  it('a slow but successful check is not reported as a timeout', async () => {
    const s = await boot();
    const real = s.ctx.db;
    const slow: Database = { ...real, dialect: real.dialect, query: async (q, p) => { await new Promise((r) => setTimeout(r, 40)); return real.query(q, p); }, run: real.run.bind(real), exec: real.exec.bind(real), transaction: real.transaction.bind(real), close: real.close.bind(real) };
    const fake = Object.create(s.ctx, { db: { get: () => slow } }) as AppContext;
    const { statusCode, body } = await createHealthService(fake, { timeoutMs: 2000, cacheMs: 0 }).run();
    expect(statusCode).toBe(200);
    expect(body.timed_out).toBe(false);
  });

  it('caches briefly and coalesces; cache is bypassed when disabled', async () => {
    const s = await boot();
    const svc = createHealthService(s.ctx, { timeoutMs: 2000, cacheMs: 5000 });
    const a = await svc.run();
    const b = await svc.run();
    expect(a.body.cached).toBe(false);
    expect(b.body.cached).toBe(true);
    const none = createHealthService(s.ctx, { timeoutMs: 2000, cacheMs: 0 });
    expect((await none.run()).body.cached).toBe(false);
    expect((await none.run()).body.cached).toBe(false);
  });
});
