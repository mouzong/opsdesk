import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, type AppOptions } from '../app.js';
import { loadConfig, type Config, type DbClient } from '../config.js';
import { createContext, type AppContext } from '../context.js';
import { openDatabase } from '../db/index.js';

/** SQLite always; PostgreSQL / MySQL when TEST_POSTGRES_URL / TEST_MYSQL_URL point at a disposable database. */
export const ENGINES: { name: DbClient; url?: string }[] = [
  { name: 'sqlite' },
  ...(process.env.TEST_POSTGRES_URL ? [{ name: 'postgres' as const, url: process.env.TEST_POSTGRES_URL }] : []),
  ...(process.env.TEST_MYSQL_URL ? [{ name: 'mysql' as const, url: process.env.TEST_MYSQL_URL }] : []),
];

export interface TestServer {
  ctx: AppContext;
  base: string;
  port: number;
  dataDir: string;
  csrf: string;
  close(): Promise<void>;
  /** Authenticated same-origin JSON request, as the real frontend sends it. */
  api<T = any>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; body: T; headers: Headers }>;
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'opsdesk-test-'));
}

export function testConfig(dataDir: string, engine: { name: DbClient; url?: string } = { name: 'sqlite' }, over: Partial<Config> = {}): Config {
  const env: NodeJS.ProcessEnv = { OPSDESK_DATA_DIR: dataDir, OPSDESK_DB_CLIENT: engine.name, OPSDESK_DB_SSL: 'off', OPSDESK_HEALTH_CACHE_SECONDS: '0' };
  if (engine.url) env.OPSDESK_DATABASE_URL = engine.url;
  const cfg = loadConfig(env, dataDir);
  return { ...cfg, port: 0, serveWeb: false, autoBackupKeep: 3, ...over };
}

/** Empties an external database completely so every test starts from a fresh migration run. */
export async function resetExternal(config: Config): Promise<void> {
  if (config.database.client === 'sqlite') return;
  const db = await openDatabase(config.database);
  for (const t of ['health_probe', 'bookmarks', 'bookmark_groups', 'workspaces', 'meta', 'schema_migrations']) {
    await db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  await db.close();
}

export async function newContext(engine: { name: DbClient; url?: string }, opts: { dataDir?: string; reset?: boolean; config?: Partial<Config> } = {}) {
  const dataDir = opts.dataDir ?? tempDir();
  const config = testConfig(dataDir, engine, opts.config);
  if (opts.reset ?? !opts.dataDir) await resetExternal(config);
  return { ctx: await createContext(config), dataDir };
}

export async function startServer(opts: { dataDir?: string; engine?: { name: DbClient; url?: string }; reset?: boolean; app?: AppOptions; config?: Partial<Config> } = {}): Promise<TestServer> {
  const { ctx, dataDir } = await newContext(opts.engine ?? { name: 'sqlite' }, { ...(opts.dataDir ? { dataDir: opts.dataDir } : {}), ...(opts.reset !== undefined ? { reset: opts.reset } : {}), ...(opts.config ? { config: opts.config } : {}) });
  const app = createApp(ctx, { quiet: true, ...opts.app });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const session = (await (await fetch(`${base}/api/session`)).json()) as { csrfToken: string };
  const csrf = session.csrfToken;
  return {
    ctx, base, port, dataDir, csrf,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      try { await ctx.closeDb(); } catch { /* already closed */ }
    },
    async api(method, path, body, extraHeaders = {}) {
      const res = await fetch(`${base}/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', origin: base, 'x-csrf-token': csrf, ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, body: parsed as never, headers: res.headers };
    },
  };
}

export function cleanup(dir: string) {
  rmSync(dir, { recursive: true, force: true });
}
