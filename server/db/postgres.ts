import type { Pool, PoolClient } from 'pg';
import type { DatabaseSettings } from '../config.js';
import { DatabaseConfigError } from './errors.js';
import { Mutex } from './mutex.js';
import type { Database, Executor, Param, Row } from './types.js';

const toPg = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

class PgExec implements Executor {
  readonly dialect = 'postgres' as const;
  constructor(protected readonly target: Pool | PoolClient, private readonly inTx: boolean, private readonly writeLock: Mutex = new Mutex()) {}
  async query(sql: string, params: Param[] = []): Promise<Row[]> {
    return (await this.target.query(toPg(sql), params)).rows as Row[];
  }
  async run(sql: string, params: Param[] = []) {
    return { changes: (await this.target.query(toPg(sql), params)).rowCount ?? 0 };
  }
  async exec(sql: string) {
    await this.target.query(sql);
  }
  async transaction<T>(fn: (tx: Executor) => Promise<T>, opts: { rollback?: boolean } = {}): Promise<T> {
    if (this.inTx) return fn(this);
    return this.writeLock.run(() => this.runTx(fn, opts));
  }
  private async runTx<T>(fn: (tx: Executor) => Promise<T>, opts: { rollback?: boolean }): Promise<T> {
    const client = await (this.target as Pool).connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgExec(client, true, this.writeLock));
      await client.query(opts.rollback ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* connection already broken */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function openPostgres(s: DatabaseSettings): Promise<Database> {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v: string) => Number(v)); // COUNT(*) etc. arrive as bigint text
  const u = s.connection!;
  const pool = new pg.Pool({
    host: u.host, port: u.port, user: u.user, password: u.password, database: u.database,
    ssl: s.ssl ?? false,
    max: s.poolMax,
    connectionTimeoutMillis: s.connectTimeoutMs,
    idleTimeoutMillis: 30_000,
    statement_timeout: s.queryTimeoutMs,
    query_timeout: s.queryTimeoutMs,
    application_name: 'opsdesk',
  });
  pool.on('error', () => {
    /* idle client dropped by the server: the pool replaces it; never log driver text (may contain host data) */
  });
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw new DatabaseConfigError(`Could not connect to the PostgreSQL database${codeOf(err)}. Check OPSDESK_DATABASE_URL, network access and TLS settings.`);
  }
  const exec = new PgExec(pool, false);
  return Object.assign(exec, { close: () => pool.end() }) as unknown as Database;
}

function codeOf(err: unknown): string {
  const c = (err as { code?: unknown })?.code;
  return typeof c === 'string' && /^[A-Z0-9_]{2,30}$/.test(c) ? ` (${c})` : '';
}
