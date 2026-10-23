export type Dialect = 'sqlite' | 'postgres' | 'mysql';
export type Param = string | number | null;
export type Row = Record<string, unknown>;

/**
 * The only door to persistence. SQL is written once, with `?` placeholders and "double-quoted" identifiers;
 * each driver adapts it (PostgreSQL: $1..$n, MySQL: backticks). Booleans are stored as 0/1, timestamps as
 * ISO-8601 text and JSON as text, so every engine stores exactly the same values.
 */
export interface Executor {
  readonly dialect: Dialect;
  query(sql: string, params?: Param[]): Promise<Row[]>;
  run(sql: string, params?: Param[]): Promise<{ changes: number }>;
  /** DDL or other parameter-less statements. */
  exec(sql: string): Promise<void>;
  /**
   * Runs fn in one transaction. Re-entrant: inside a transaction, nested calls join it.
   * With `rollback: true` the transaction is always rolled back (exact previews, health probes).
   */
  transaction<T>(fn: (tx: Executor) => Promise<T>, opts?: { rollback?: boolean }): Promise<T>;
}

export interface Database extends Executor {
  close(): Promise<void>;
}
