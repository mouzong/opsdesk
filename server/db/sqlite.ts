import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Database, Executor, Param, Row } from './types.js';

class SqliteTx implements Executor {
  readonly dialect = 'sqlite' as const;
  constructor(protected readonly conn: DatabaseSync) {}
  async query(sql: string, params: Param[] = []): Promise<Row[]> {
    return this.conn.prepare(sql).all(...(params as SQLInputValue[])) as Row[];
  }
  async run(sql: string, params: Param[] = []) {
    return { changes: Number(this.conn.prepare(sql).run(...(params as SQLInputValue[])).changes) };
  }
  async exec(sql: string) {
    this.conn.exec(sql);
  }
  transaction<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return fn(this); // already inside a transaction
  }
}

/**
 * node:sqlite is synchronous, but callers interleave at `await` points. A FIFO queue guarantees that a
 * transaction never sees (or runs) another request's statements.
 */
class SqliteDb extends SqliteTx implements Database {
  private chain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(() => fn());
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }
  override query(sql: string, params: Param[] = []) {
    return this.enqueue(() => super.query(sql, params));
  }
  override run(sql: string, params: Param[] = []) {
    return this.enqueue(() => super.run(sql, params));
  }
  override exec(sql: string) {
    return this.enqueue(() => super.exec(sql));
  }
  override transaction<T>(fn: (tx: Executor) => Promise<T>, opts: { rollback?: boolean } = {}): Promise<T> {
    return this.enqueue(async () => {
      this.conn.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(new SqliteTx(this.conn));
        this.conn.exec(opts.rollback ? 'ROLLBACK' : 'COMMIT');
        return result;
      } catch (err) {
        try {
          this.conn.exec('ROLLBACK');
        } catch {
          /* already rolled back */
        }
        throw err;
      }
    });
  }
  async close() {
    await this.chain;
    this.conn.close();
  }
}

export function openSqlite(file: string): Database {
  mkdirSync(dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  // Single plain file (no -wal/-shm side files) keeps backup, copy and sync tools simple and safe.
  // foreign_keys is enforced explicitly; busy_timeout covers a second process briefly holding the file.
  conn.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  return new SqliteDb(conn);
}
