import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';

export type DbClient = 'sqlite' | 'postgres' | 'mysql';
export const DB_CLIENTS: readonly DbClient[] = ['sqlite', 'postgres', 'mysql'];

export interface DatabaseSettings {
  client: DbClient;
  /** SQLite only. */
  sqlitePath: string;
  /** PostgreSQL/MySQL only. Holds credentials: never serialise, log or return it. */
  connection?: { host: string; port: number; user: string; password: string; database: string };
  ssl: { rejectUnauthorized: boolean; ca?: string } | null;
  poolMax: number;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
}

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Required to bind to anything other than a loopback address. */
  allowNetwork: boolean;
  /** Extra host names (without port) accepted in the Host header. localhost/127.0.0.1/[::1] are always accepted. */
  allowedHosts: string[];
  /** Serve the compiled frontend (disabled in dev, where Vite serves it). */
  serveWeb: boolean;
  /** Number of automatic backups to keep. */
  autoBackupKeep: number;
  database: DatabaseSettings;
  health: { timeoutMs: number; cacheMs: number };
  /**
   * Bearer token for CLI/automation access to the HTTP API (environment only, never in the JSON file).
   * undefined = API token access disabled. Secret: never serialise, log or return it.
   */
  apiToken?: string;
  /** Exact browser origins (scheme://host[:port]) allowed to call the API with a bearer token from another origin. Never a wildcard. */
  corsOrigins: string[];
  /** Trust X-Forwarded-Proto from a reverse proxy when deciding whether a request is HTTPS. */
  trustProxy: boolean;
}

const fileSchema = z
  .object({
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    dataDir: z.string().optional(),
    allowNetwork: z.boolean().optional(),
    allowedHosts: z.array(z.string().min(1)).optional(),
    autoBackupKeep: z.number().int().min(1).max(500).optional(),
    corsOrigins: z.array(z.string().min(1)).optional(),
    trustProxy: z.boolean().optional(),
    database: z
      .object({
        client: z.string().optional(),
        sqlitePath: z.string().optional(),
        ssl: z.enum(['auto', 'on', 'off']).optional(),
        poolMax: z.number().int().min(1).max(100).optional(),
        connectTimeoutMs: z.number().int().min(500).max(120000).optional(),
        queryTimeoutMs: z.number().int().min(500).max(600000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export function defaultDataDir(): string {
  const home = homedir();
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'OpsDesk');
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'OpsDesk');
  return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'opsdesk');
}

export function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || h === '127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const configPath = env.OPSDESK_CONFIG ? resolve(cwd, env.OPSDESK_CONFIG) : resolve(cwd, 'opsdesk.config.json');
  let file: z.infer<typeof fileSchema> = {};
  if (existsSync(configPath)) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      throw new Error(`Configuration file ${configPath} is not valid JSON.`);
    }
    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      throw new Error(`Configuration file ${configPath} is invalid: ${detail}`);
    }
    file = parsed.data;
  } else if (env.OPSDESK_CONFIG) {
    throw new Error(`Configuration file ${configPath} (OPSDESK_CONFIG) does not exist.`);
  }

  const port = env.OPSDESK_PORT !== undefined ? Number(env.OPSDESK_PORT) : (file.port ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port "${env.OPSDESK_PORT ?? file.port}".`);

  const host = env.OPSDESK_HOST ?? file.host ?? '127.0.0.1';
  const allowNetwork = env.OPSDESK_ALLOW_NETWORK !== undefined ? env.OPSDESK_ALLOW_NETWORK === '1' : (file.allowNetwork ?? false);
  if (!isLoopback(host) && !allowNetwork) {
    throw new Error(
      `Refusing to bind to "${host}". OpsDesk has no authentication and is meant for localhost only. ` +
        'Set allowNetwork (OPSDESK_ALLOW_NETWORK=1) only if you understand the risks - see README, "Network exposure".',
    );
  }

  const rawDir = env.OPSDESK_DATA_DIR || file.dataDir || '';
  const dataDir = rawDir ? (isAbsolute(rawDir) ? rawDir : resolve(cwd, rawDir)) : defaultDataDir();
  const extraHosts = env.OPSDESK_ALLOWED_HOSTS
    ? env.OPSDESK_ALLOWED_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
    : (file.allowedHosts ?? []);

  const database = buildDatabaseSettings(env, cwd, file.database, dataDir);

  const config: Config = {
    host,
    port,
    dataDir,
    allowNetwork,
    allowedHosts: extraHosts.map((h) => h.toLowerCase()),
    serveWeb: env.OPSDESK_SERVE_WEB !== '0',
    autoBackupKeep: file.autoBackupKeep ?? 20,
    database,
    apiToken: readApiToken(env, cwd),
    corsOrigins: parseCorsOrigins(env.OPSDESK_CORS_ORIGINS !== undefined ? env.OPSDESK_CORS_ORIGINS.split(',') : (file.corsOrigins ?? [])),
    trustProxy: env.OPSDESK_TRUST_PROXY !== undefined ? env.OPSDESK_TRUST_PROXY === '1' : (file.trustProxy ?? false),
    health: {
      timeoutMs: intEnv(env.OPSDESK_HEALTH_TIMEOUT_MS, 3000, 100, 60000, 'OPSDESK_HEALTH_TIMEOUT_MS'),
      cacheMs: intEnv(env.OPSDESK_HEALTH_CACHE_SECONDS, 5, 0, 300, 'OPSDESK_HEALTH_CACHE_SECONDS') * 1000,
    },
  };
  // The token is a secret: keep it out of JSON.stringify / object spreads / accidental logging.
  if (config.apiToken !== undefined) Object.defineProperty(config, 'apiToken', { enumerable: false });
  return config;
}

const TOKEN_RE = /^[A-Za-z0-9._~+\/=-]{24,256}$/;

/** OPSDESK_API_TOKEN / OPSDESK_API_TOKEN_FILE. Errors never echo the value. */
function readApiToken(env: NodeJS.ProcessEnv, cwd: string): string | undefined {
  const token = readSecret(env, 'OPSDESK_API_TOKEN', cwd);
  if (token === undefined) return undefined;
  if (!TOKEN_RE.test(token)) {
    throw new Error('OPSDESK_API_TOKEN must be 24-256 characters from A-Z a-z 0-9 . _ ~ + / = - (generate one with: npm run token:generate).');
  }
  return token;
}

/** Exact origins only: "*", paths, credentials and non-http(s) schemes are refused. */
export function parseCorsOrigins(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list.map((x) => x.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new Error('OPSDESK_CORS_ORIGINS contains an invalid origin. Use exact origins such as http://127.0.0.1:8000 (no wildcards).');
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== raw.toLowerCase().replace(/\/$/, '') || raw.includes('*') || !/^[a-z0-9.\-[\]:]+$/i.test(u.host)) {
      throw new Error('OPSDESK_CORS_ORIGINS entries must be exact origins like http://127.0.0.1:8000 (scheme, host, optional port; no path, no wildcard).');
    }
    out.push(u.origin.toLowerCase());
  }
  return [...new Set(out)];
}

function intEnv(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return n;
}

function readSecret(env: NodeJS.ProcessEnv, name: string, cwd: string): string | undefined {
  const direct = env[name];
  const fileVar = env[`${name}_FILE`];
  if (direct && fileVar) throw new Error(`Set either ${name} or ${name}_FILE, not both.`);
  if (fileVar) {
    const path = resolve(cwd, fileVar);
    if (!existsSync(path)) throw new Error(`${name}_FILE points to a file that does not exist.`);
    return readFileSync(path, 'utf8').trim() || undefined;
  }
  return direct || undefined;
}

/** Parses postgres://user:password@host:5432/database. Never echoes the value in errors. */
export function parseDatabaseUrl(client: 'postgres' | 'mysql', url: string): NonNullable<DatabaseSettings['connection']> {
  const label = client === 'postgres' ? 'postgres://user:password@host:5432/database' : 'mysql://user:password@host:3306/database';
  const bad = (why: string) => new Error(`OPSDESK_DATABASE_URL is not valid for ${client} (${why}). Expected ${label}. Percent-encode special characters in the password.`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw bad('cannot be parsed');
  }
  const okProtocol = client === 'postgres' ? ['postgres:', 'postgresql:'] : ['mysql:'];
  if (!okProtocol.includes(u.protocol)) throw bad('wrong scheme');
  if (u.search || u.hash) throw bad('query parameters are not supported; use the OPSDESK_DB_* variables for TLS and pool settings');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!u.hostname) throw bad('host is missing');
  if (!u.username) throw bad('user is missing');
  if (!database) throw bad('database name is missing');
  const connection = {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port ? Number(u.port) : client === 'postgres' ? 5432 : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
  Object.defineProperty(connection, 'toJSON', { value: () => '[redacted]', enumerable: false });
  return connection;
}

function buildDatabaseSettings(env: NodeJS.ProcessEnv, cwd: string, file: z.infer<typeof fileSchema>['database'], dataDir: string): DatabaseSettings {
  const rawClient = (env.OPSDESK_DB_CLIENT ?? file?.client ?? 'sqlite').trim().toLowerCase();
  const aliases: Record<string, DbClient> = { sqlite: 'sqlite', sqlite3: 'sqlite', postgres: 'postgres', postgresql: 'postgres', pg: 'postgres', mysql: 'mysql', mariadb: 'mysql' };
  const client = aliases[rawClient];
  if (!client) {
    // Echo the value only if it is a plain identifier: a URL or secret pasted into the wrong variable must never be printed.
    const shown = /^[a-z0-9_-]{1,20}$/.test(rawClient) ? `"${rawClient}"` : '(value not shown)';
    throw new Error(`Unsupported database client ${shown}. Supported values for OPSDESK_DB_CLIENT: ${DB_CLIENTS.join(', ')}.`);
  }
  const url = readSecret(env, 'OPSDESK_DATABASE_URL', cwd);
  const sqliteRaw = env.OPSDESK_SQLITE_PATH ?? file?.sqlitePath;
  const sqlitePath = sqliteRaw ? resolve(cwd, sqliteRaw) : resolve(dataDir, 'opsdesk.sqlite');

  const base = {
    poolMax: intEnv(env.OPSDESK_DB_POOL_MAX, file?.poolMax ?? 5, 1, 100, 'OPSDESK_DB_POOL_MAX'),
    connectTimeoutMs: intEnv(env.OPSDESK_DB_CONNECT_TIMEOUT_MS, file?.connectTimeoutMs ?? 10000, 500, 120000, 'OPSDESK_DB_CONNECT_TIMEOUT_MS'),
    queryTimeoutMs: intEnv(env.OPSDESK_DB_QUERY_TIMEOUT_MS, file?.queryTimeoutMs ?? 15000, 500, 600000, 'OPSDESK_DB_QUERY_TIMEOUT_MS'),
  };

  if (client === 'sqlite') {
    if (url) {
      throw new Error('OPSDESK_DATABASE_URL is set but OPSDESK_DB_CLIENT is "sqlite". Set OPSDESK_DB_CLIENT=postgres or mysql, or unset the URL. OpsDesk will not guess.');
    }
    return { client, sqlitePath, ssl: null, ...base };
  }

  if (!url) throw new Error(`OPSDESK_DB_CLIENT=${client} requires OPSDESK_DATABASE_URL (or OPSDESK_DATABASE_URL_FILE).`);
  const connection = parseDatabaseUrl(client, url);

  const mode = (env.OPSDESK_DB_SSL ?? file?.ssl ?? 'auto').toLowerCase();
  if (!['auto', 'on', 'off'].includes(mode)) throw new Error('OPSDESK_DB_SSL must be auto, on or off.');
  const useTls = mode === 'on' || (mode === 'auto' && !isLoopback(connection.host));
  let ssl: DatabaseSettings['ssl'] = null;
  if (useTls) {
    const caFile = env.OPSDESK_DB_SSL_CA_FILE;
    if (caFile && !existsSync(resolve(cwd, caFile))) throw new Error('OPSDESK_DB_SSL_CA_FILE points to a file that does not exist.');
    // Certificate verification stays ON unless this explicit, loudly named variable is set.
    ssl = { rejectUnauthorized: env.OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY !== '1', ...(caFile ? { ca: readFileSync(resolve(cwd, caFile), 'utf8') } : {}) };
  }
  return { client, sqlitePath, connection, ssl, ...base };
}

/** Safe, credential-free description for logs and the UI. */
/** Credential-free summary of API access settings (safe for logs/UI). */
export function describeApiAccess(c: Config): { bearerToken: boolean; corsOrigins: number } {
  return { bearerToken: c.apiToken !== undefined, corsOrigins: c.corsOrigins.length };
}

export function describeDatabase(d: DatabaseSettings): { client: DbClient; label: string; tls: boolean | null } {
  const label = d.client === 'sqlite' ? 'SQLite' : d.client === 'postgres' ? 'PostgreSQL' : 'MySQL';
  return { client: d.client, label, tls: d.client === 'sqlite' ? null : d.ssl !== null };
}
