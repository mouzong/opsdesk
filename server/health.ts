import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { AppContext } from './context.js';
import { migrationStatus } from './db/migrate.js';
import { VERSION } from './version.js';

export type CheckStatus = 'green' | 'yellow' | 'red' | 'not_applicable';
export type OverallStatus = 'green' | 'yellow' | 'red';

/** Machine-readable, deliberately vague reasons. Raw driver errors, paths and stack traces never leave the process. */
export type CheckError = 'timeout' | 'unavailable' | 'read_failed' | 'write_failed' | 'not_writable' | 'migrations_pending' | 'schema_newer_than_application';

export interface HealthReport {
  application_name: 'opsdesk';
  status: OverallStatus;
  timed_out: boolean;
  version: string;
  timestamp: string;
  uptime_in_seconds: number;
  cached: boolean;
  checks: {
    database: { status: CheckStatus; type: string; readable: boolean; writable: boolean; response_time_ms: number; error?: CheckError };
    storage: {
      status: CheckStatus;
      data_directory_writable: boolean | 'not_applicable';
      backup_directory_writable: boolean;
      error?: CheckError;
    };
    migrations: { status: CheckStatus; current_version: string | null; latest_version: string; pending: number | null; error?: CheckError };
  };
  response_time_ms: number;
}

export interface HealthOptions {
  timeoutMs: number;
  cacheMs: number;
}

type Bounded<T> = { ok: true; value: T } | { ok: false; reason: 'timeout' | 'failed' };

async function bounded<T>(fn: () => Promise<T>, ms: number): Promise<Bounded<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Bounded<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), ms);
  });
  const work = (async () => fn())().then(
    (value): Bounded<T> => ({ ok: true, value }),
    (): Bounded<T> => ({ ok: false, reason: 'failed' }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Existence is not enough: create and delete a uniquely named file to prove the directory is writable. */
async function directoryWritable(dir: string): Promise<boolean> {
  const probe = join(dir, `.opsdesk-health-${process.pid}-${randomUUID().slice(0, 8)}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, '', { flag: 'wx' });
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

const rank = { green: 0, not_applicable: 0, yellow: 1, red: 2 } as const;
const typeName = (c: AppContext['engine']) => (c === 'postgres' ? 'postgresql' : c);
const round = (n: number) => Math.max(0, Math.round(n));

export function createHealthService(ctx: AppContext, options: HealthOptions) {
  let cache: { at: number; report: HealthReport } | null = null;
  let inflight: Promise<HealthReport> | null = null;

  async function compute(): Promise<HealthReport> {
    const started = performance.now();
    const ms = options.timeoutMs;

    const dbCheck = async (): Promise<HealthReport['checks']['database']> => {
      const t0 = performance.now();
      let readable = false;
      let writable = false;
      const r = await bounded(async () => {
        const db = ctx.db;
        await db.query('SELECT 1 AS ok');
        await db.query('SELECT COUNT(*) AS n FROM meta');
        readable = true;
        // Write probe: insert into a dedicated table inside a transaction that is ALWAYS rolled back.
        // No user table is touched and nothing is left behind; read-only replicas/files fail here.
        await db.transaction(async (tx) => {
          const id = randomUUID();
          await tx.run('INSERT INTO health_probe (id, created_at) VALUES (?, ?)', [id, new Date().toISOString()]);
          const back = await tx.query('SELECT id FROM health_probe WHERE id = ?', [id]);
          if (back.length !== 1) throw new Error('probe');
        }, { rollback: true });
        writable = true;
      }, ms);
      const status: CheckStatus = readable && writable ? 'green' : 'red';
      const error: CheckError | undefined = r.ok ? undefined : r.reason === 'timeout' ? 'timeout' : readable ? 'write_failed' : 'read_failed';
      return { status, type: typeName(ctx.engine), readable, writable, response_time_ms: round(performance.now() - t0), ...(error ? { error } : {}) };
    };

    const storageCheck = async (): Promise<HealthReport['checks']['storage']> => {
      const sqlite = ctx.engine === 'sqlite';
      const r = await bounded(async () => ({
        data: sqlite ? await directoryWritable(dirname(ctx.dbPath)) : null,
        backup: await directoryWritable(ctx.backupDir),
      }), ms);
      if (!r.ok) {
        return { status: 'red', data_directory_writable: sqlite ? false : 'not_applicable', backup_directory_writable: false, error: r.reason === 'timeout' ? 'timeout' : 'unavailable' };
      }
      const { data, backup } = r.value;
      // The SQLite directory must be writable (journal files); the backups folder is an optional capability.
      const status: CheckStatus = sqlite && data === false ? 'red' : backup ? 'green' : 'yellow';
      return {
        status,
        data_directory_writable: sqlite ? (data as boolean) : 'not_applicable',
        backup_directory_writable: backup,
        ...(status !== 'green' ? { error: 'not_writable' as const } : {}),
      };
    };

    const migrationsCheck = async (): Promise<HealthReport['checks']['migrations']> => {
      const r = await bounded(() => migrationStatus(ctx.db), ms);
      if (!r.ok) return { status: 'red', current_version: null, latest_version: '', pending: null, error: r.reason === 'timeout' ? 'timeout' : 'unavailable' };
      const { current, latest, pending } = r.value;
      if (Number(current) > Number(latest)) return { status: 'red', current_version: current, latest_version: latest, pending, error: 'schema_newer_than_application' };
      if (pending > 0) return { status: 'red', current_version: current, latest_version: latest, pending, error: 'migrations_pending' };
      return { status: 'green', current_version: current, latest_version: latest, pending };
    };

    const [database, storage, migrations] = await Promise.all([dbCheck(), storageCheck(), migrationsCheck()]);
    const all = [database, storage, migrations];
    const worst = all.reduce<number>((m, c) => Math.max(m, rank[c.status]), 0);
    return {
      application_name: 'opsdesk',
      status: worst === 2 ? 'red' : worst === 1 ? 'yellow' : 'green',
      timed_out: all.some((c) => c.error === 'timeout'),
      version: VERSION,
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      uptime_in_seconds: Math.floor(process.uptime()),
      cached: false,
      checks: { database, storage, migrations },
      response_time_ms: round(performance.now() - started),
    };
  }

  return {
    /** HTTP 200 for green/yellow, 503 for red. Results are cached briefly (red only for 1 s so recovery shows quickly). */
    async run(): Promise<{ statusCode: number; body: HealthReport }> {
      const t0 = performance.now();
      if (cache) {
        const ttl = cache.report.status === 'red' ? Math.min(options.cacheMs, 1000) : options.cacheMs;
        if (Date.now() - cache.at < ttl) {
          const body: HealthReport = {
            ...cache.report, cached: true, uptime_in_seconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), response_time_ms: round(performance.now() - t0),
          };
          return { statusCode: body.status === 'red' ? 503 : 200, body };
        }
      }
      inflight ??= compute().finally(() => { inflight = null; });
      const report = await inflight;
      if (options.cacheMs > 0) cache = { at: Date.now(), report };
      return { statusCode: report.status === 'red' ? 503 : 200, body: report };
    },
  };
}
