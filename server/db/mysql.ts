import type { Pool, PoolConnection } from 'mysql2/promise';
import type { DatabaseSettings } from '../config.js';
import { DatabaseConfigError } from './errors.js';
import { Mutex } from './mutex.js';
import type { Database, Executor, Param, Row } from './types.js';

const toMysql = (sql: string) => sql.replace(/"/g, '`');

class MyExec implements Executor {
  readonly dialect = 'mysql' as const;
  constructor(protected readonly target: Pool | PoolConnection, private readonly inTx: boolean, private readonly timeout: number, private readonly writeLock: Mutex = new Mutex()) {}
  async query(sql: string, params: Param[] = []): Promise<Row[]> {
    const [rows] = await this.target.execute({ sql: toMysql(sql), values: params, timeout: this.timeout });
    return rows as Row[];
  }
  async run(sql: string, params: Param[] = []) {
    const [res] = await this.target.execute({ sql: toMysql(sql), values: params, timeout: this.timeout });
    return { changes: Number((res as { affectedRows?: number }).affectedRows ?? 0) };
  }
  async exec(sql: string) {
    await this.target.query({ sql: toMysql(sql), timeout: this.timeout });
  }
  async transaction<T>(fn: (tx: Executor) => Promise<T>, opts: { rollback?: boolean } = {}): Promise<T> {
    if (this.inTx) return fn(this);
    return this.writeLock.run(() => this.runTx(fn, opts));
  }
  private async runTx<T>(fn: (tx: Executor) => Promise<T>, opts: { rollback?: boolean }): Promise<T> {
    const conn = await (this.target as Pool).getConnection();
    try {
      await conn.query('START TRANSACTION');
      const result = await fn(new MyExec(conn, true, this.timeout, this.writeLock));
      await conn.query(opts.rollback ? 'ROLLBACK' : 'COMMIT');
      return result;
    } catch (err) {
      try {
        await conn.query('ROLLBACK');
      } catch {
        /* connection already broken */
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

export async function openMysql(s: DatabaseSettings): Promise<Database> {
  const mysql = await import('mysql2/promise');
  const u = s.connection!;
  const pool = mysql.createPool({
    host: u.host, port: u.port, user: u.user, password: u.password, database: u.database,
    ssl: s.ssl ?? undefined,
    connectionLimit: s.poolMax,
    waitForConnections: true,
    queueLimit: 100,
    connectTimeout: s.connectTimeoutMs,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    multipleStatements: false,
  });
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw new DatabaseConfigError(`Could not connect to the MySQL database${codeOf(err)}. Check OPSDESK_DATABASE_URL, network access and TLS settings.`);
  }
  const exec = new MyExec(pool, false, s.queryTimeoutMs);
  return Object.assign(exec, { close: () => pool.end() }) as unknown as Database;
}

function codeOf(err: unknown): string {
  const c = (err as { code?: unknown })?.code;
  return typeof c === 'string' && /^[A-Z0-9_]{2,40}$/.test(c) ? ` (${c})` : '';
}
