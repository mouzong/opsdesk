import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeDatabase, loadConfig, parseDatabaseUrl } from '../config.js';
import { createContext } from '../context.js';
import { cleanup, tempDir } from './helpers.js';

const dirs: string[] = [];
const cfg = (env: NodeJS.ProcessEnv) => {
  const d = tempDir();
  dirs.push(d);
  return loadConfig({ OPSDESK_DATA_DIR: d, ...env }, d);
};
afterEach(() => { while (dirs.length) cleanup(dirs.pop()!); });

describe('database configuration contract', () => {
  it('defaults to SQLite inside the data directory with no external service', () => {
    const c = cfg({});
    expect(c.database.client).toBe('sqlite');
    expect(c.database.sqlitePath.endsWith('opsdesk.sqlite')).toBe(true);
    expect(c.database.connection).toBeUndefined();
  });
  it('OPSDESK_SQLITE_PATH overrides the file location', () => {
    expect(cfg({ OPSDESK_SQLITE_PATH: 'elsewhere/x.sqlite' }).database.sqlitePath).toMatch(/elsewhere\/x\.sqlite$/);
  });
  it('rejects an unsupported engine with a clear message listing the supported ones', () => {
    expect(() => cfg({ OPSDESK_DB_CLIENT: 'oracle' })).toThrowError(/Unsupported database client "oracle".*sqlite, postgres, mysql/);
  });
  it('never echoes a secret pasted into OPSDESK_DB_CLIENT', () => {
    try {
      cfg({ OPSDESK_DB_CLIENT: 'postgres://opsdesk:SuperSecret1@db/x' });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toMatch(/SuperSecret1|opsdesk:|postgres:/);
      expect((e as Error).message).toMatch(/Unsupported database client/);
    }
  });
  it('requires a URL for PostgreSQL and MySQL', () => {
    expect(() => cfg({ OPSDESK_DB_CLIENT: 'postgres' })).toThrowError(/requires OPSDESK_DATABASE_URL/);
    expect(() => cfg({ OPSDESK_DB_CLIENT: 'mysql' })).toThrowError(/requires OPSDESK_DATABASE_URL/);
  });
  it('refuses a URL combined with SQLite instead of guessing', () => {
    expect(() => cfg({ OPSDESK_DATABASE_URL: 'postgres://u:p@h/d' })).toThrowError(/will not guess/);
  });
  it('errors never echo the URL or the password', () => {
    for (const [client, url] of [['postgres', 'mysql://u:SuperSecret1@h/d'], ['postgres', 'postgres://u:SuperSecret1@h/d?sslmode=require'], ['mysql', 'mysql://:SuperSecret1@h/d'], ['mysql', 'not a url SuperSecret1']] as const) {
      try {
        cfg({ OPSDESK_DB_CLIENT: client, OPSDESK_DATABASE_URL: url });
        expect.unreachable();
      } catch (e) {
        expect((e as Error).message).not.toContain('SuperSecret1');
        expect((e as Error).message).toMatch(/OPSDESK_DATABASE_URL/);
      }
    }
  });
  it('parses and decodes URLs, applies default ports', () => {
    expect(parseDatabaseUrl('postgres', 'postgres://ops%40desk:p%2Fw%3Ad@db.internal/opsdesk')).toMatchObject({ host: 'db.internal', port: 5432, user: 'ops@desk', password: 'p/w:d', database: 'opsdesk' });
    expect(parseDatabaseUrl('mysql', 'mysql://u:p@[::1]:3307/d')).toMatchObject({ host: '::1', port: 3307 });
  });
  it('credentials are redacted if the connection object is ever serialised', () => {
    const c = cfg({ OPSDESK_DB_CLIENT: 'postgres', OPSDESK_DATABASE_URL: 'postgres://u:SuperSecret1@db.internal/d' });
    expect(JSON.stringify(c.database.connection)).toBe('"[redacted]"');
    expect(JSON.stringify(describeDatabase(c.database))).not.toMatch(/SuperSecret1|db\.internal/);
  });
  it('TLS: verified by default for remote hosts, off for loopback, skipping verification needs an explicit variable', () => {
    const remote = cfg({ OPSDESK_DB_CLIENT: 'postgres', OPSDESK_DATABASE_URL: 'postgres://u:p@db.internal/d' });
    expect(remote.database.ssl).toEqual({ rejectUnauthorized: true });
    expect(cfg({ OPSDESK_DB_CLIENT: 'postgres', OPSDESK_DATABASE_URL: 'postgres://u:p@127.0.0.1/d' }).database.ssl).toBeNull();
    expect(cfg({ OPSDESK_DB_CLIENT: 'mysql', OPSDESK_DATABASE_URL: 'mysql://u:p@db.internal/d', OPSDESK_DB_SSL: 'off' }).database.ssl).toBeNull();
    expect(cfg({ OPSDESK_DB_CLIENT: 'mysql', OPSDESK_DATABASE_URL: 'mysql://u:p@127.0.0.1/d', OPSDESK_DB_SSL: 'on' }).database.ssl).toEqual({ rejectUnauthorized: true });
    expect(cfg({ OPSDESK_DB_CLIENT: 'mysql', OPSDESK_DATABASE_URL: 'mysql://u:p@db.internal/d', OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY: '1' }).database.ssl).toEqual({ rejectUnauthorized: false });
  });
  it('reads the URL from a secret file (OPSDESK_DATABASE_URL_FILE) and refuses both at once', () => {
    const d = tempDir(); dirs.push(d);
    writeFileSync(join(d, 'url'), 'postgres://u:filepw@127.0.0.1/d\n');
    const c = loadConfig({ OPSDESK_DATA_DIR: d, OPSDESK_DB_CLIENT: 'postgres', OPSDESK_DATABASE_URL_FILE: 'url' }, d);
    expect(c.database.connection?.password).toBe('filepw');
    expect(() => loadConfig({ OPSDESK_DATA_DIR: d, OPSDESK_DB_CLIENT: 'postgres', OPSDESK_DATABASE_URL_FILE: 'url', OPSDESK_DATABASE_URL: 'postgres://a:b@c/d' }, d)).toThrowError(/not both/);
  });
  it('the JSON config file cannot carry a URL (secrets stay in the environment)', () => {
    const d = tempDir(); dirs.push(d);
    writeFileSync(join(d, 'c.json'), JSON.stringify({ database: { client: 'postgres', url: 'postgres://u:p@h/d' } }));
    expect(() => loadConfig({ OPSDESK_CONFIG: 'c.json', OPSDESK_DATA_DIR: d }, d)).toThrowError(/invalid/);
  });
  it('validates numeric settings', () => {
    expect(() => cfg({ OPSDESK_DB_POOL_MAX: '0' })).toThrowError(/OPSDESK_DB_POOL_MAX/);
    expect(() => cfg({ OPSDESK_HEALTH_TIMEOUT_MS: 'abc' })).toThrowError(/OPSDESK_HEALTH_TIMEOUT_MS/);
  });
  it('never falls back to SQLite when the external database is unreachable, and the error is sanitized', async () => {
    const d = tempDir(); dirs.push(d);
    for (const [client, url] of [['postgres', 'postgres://opsdesk:Unreach4ble@127.0.0.1:1/x'], ['mysql', 'mysql://opsdesk:Unreach4ble@127.0.0.1:1/x']] as const) {
      const c = loadConfig({ OPSDESK_DATA_DIR: d, OPSDESK_DB_CLIENT: client, OPSDESK_DATABASE_URL: url, OPSDESK_DB_SSL: 'off', OPSDESK_DB_CONNECT_TIMEOUT_MS: '1000' }, d);
      await expect(createContext(c)).rejects.toThrowError(/Could not connect to the (PostgreSQL|MySQL) database/);
      await createContext(c).catch((e: Error) => {
        expect(e.message).not.toMatch(/Unreach4ble|opsdesk:|127\.0\.0\.1/);
      });
    }
    // no sqlite file was created as a silent fallback
    expect((await import('node:fs')).existsSync(join(d, 'opsdesk.sqlite'))).toBe(false);
  });
});

describe('shipped configuration templates', () => {
  it('opsdesk.config.example.json parses and is accepted by the loader (strict, no unknown keys)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const example = resolve('opsdesk.config.example.json');
    JSON.parse(readFileSync(example, 'utf8')); // valid JSON, no comments
    const c = cfg({ OPSDESK_CONFIG: example });
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(4310);
    expect(c.database.client).toBe('sqlite');
    expect(c.allowNetwork).toBe(false);
    expect(c.autoBackupKeep).toBe(20);
    expect(c.database.poolMax).toBe(5);
  });

  it('.env.example only uses variables the application reads, and its active lines form a working SQLite configuration', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync('.env.example', 'utf8');
    const known = new Set([
      'OPSDESK_PORT', 'OPSDESK_HOST', 'OPSDESK_DATA_DIR', 'OPSDESK_ALLOW_NETWORK', 'OPSDESK_ALLOWED_HOSTS', 'OPSDESK_CONFIG', 'OPSDESK_SERVE_WEB',
      'OPSDESK_DB_CLIENT', 'OPSDESK_SQLITE_PATH', 'OPSDESK_DATABASE_URL', 'OPSDESK_DATABASE_URL_FILE', 'OPSDESK_DB_SSL', 'OPSDESK_DB_SSL_CA_FILE',
      'OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY', 'OPSDESK_DB_POOL_MAX', 'OPSDESK_DB_CONNECT_TIMEOUT_MS', 'OPSDESK_DB_QUERY_TIMEOUT_MS',
      'OPSDESK_HEALTH_TIMEOUT_MS', 'OPSDESK_HEALTH_CACHE_SECONDS', 'OPSDESK_API_TOKEN', 'OPSDESK_API_TOKEN_FILE', 'OPSDESK_CORS_ORIGINS', 'OPSDESK_TRUST_PROXY', 'POSTGRES_PASSWORD', 'MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD',
    ]);
    const env: NodeJS.ProcessEnv = {};
    for (const raw of text.split('\n')) {
      const m = /^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/.exec(raw.trim());
      if (!m) continue;
      expect(known.has(m[1]!), `unknown variable ${m[1]}`).toBe(true);
      if (!raw.trim().startsWith('#')) env[m[1]!] = m[2]!;
    }
    expect(Object.keys(env).sort()).toEqual(['OPSDESK_DB_CLIENT', 'OPSDESK_PORT']);
    const c = cfg(env);
    expect(c.database.client).toBe('sqlite');
    expect(c.port).toBe(4310);
    // no real secret in the template
    expect(text).not.toMatch(/postgres:\/\/[^:\s]+:(?!CHANGE_ME)[^@\s]+@/);
  });

  it('invalid and missing configuration give sanitized, useful errors', async () => {
    const { writeFileSync } = await import('node:fs');
    const d = tempDir(); dirs.push(d);
    writeFileSync(join(d, 'bad.json'), '{ "port": 4310, // comment\n }');
    expect(() => loadConfig({ OPSDESK_CONFIG: 'bad.json', OPSDESK_DATA_DIR: d }, d)).toThrowError(/not valid JSON/);
    writeFileSync(join(d, 'unknown.json'), JSON.stringify({ port: 4310, prot: 1 }));
    expect(() => loadConfig({ OPSDESK_CONFIG: 'unknown.json', OPSDESK_DATA_DIR: d }, d)).toThrowError(/invalid/);
    writeFileSync(join(d, 'type.json'), JSON.stringify({ port: '4310' }));
    expect(() => loadConfig({ OPSDESK_CONFIG: 'type.json', OPSDESK_DATA_DIR: d }, d)).toThrowError(/port/);
    expect(() => loadConfig({ OPSDESK_CONFIG: 'missing.json', OPSDESK_DATA_DIR: d }, d)).toThrowError(/does not exist/);
    expect(() => cfg({ OPSDESK_PORT: '99999' })).toThrowError(/Invalid port/);
    expect(() => cfg({ OPSDESK_HOST: '0.0.0.0' })).toThrowError(/Refusing to bind/);
  });

  it('precedence: environment beats opsdesk.config.json beats defaults', async () => {
    const { writeFileSync } = await import('node:fs');
    const d = tempDir(); dirs.push(d);
    writeFileSync(join(d, 'c.json'), JSON.stringify({ port: 5001, autoBackupKeep: 7, database: { poolMax: 9 } }));
    const fromFile = loadConfig({ OPSDESK_CONFIG: 'c.json', OPSDESK_DATA_DIR: d }, d);
    expect([fromFile.port, fromFile.autoBackupKeep, fromFile.database.poolMax]).toEqual([5001, 7, 9]);
    const fromEnv = loadConfig({ OPSDESK_CONFIG: 'c.json', OPSDESK_DATA_DIR: d, OPSDESK_PORT: '5002', OPSDESK_DB_POOL_MAX: '3' }, d);
    expect([fromEnv.port, fromEnv.autoBackupKeep, fromEnv.database.poolMax]).toEqual([5002, 7, 3]);
  });
});
