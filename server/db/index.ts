import type { DatabaseSettings } from '../config.js';
import { DatabaseConfigError } from './errors.js';
import { migrate } from './migrate.js';
import { openSqlite } from './sqlite.js';
import type { Database } from './types.js';

const safeCode = (err: unknown) => {
  const c = (err as { code?: unknown })?.code;
  return typeof c === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(c) ? ` (${c})` : '';
};

/** Opens the configured engine and applies pending migrations. Never falls back to another engine. */
export async function openDatabase(settings: DatabaseSettings): Promise<Database> {
  const db =
    settings.client === 'sqlite' ? openSqlite(settings.sqlitePath)
    : settings.client === 'postgres' ? await (await import('./postgres.js')).openPostgres(settings)
    : await (await import('./mysql.js')).openMysql(settings);
  try {
    await migrate(db);
  } catch (err) {
    await db.close().catch(() => undefined);
    if (err instanceof DatabaseConfigError) throw err;
    const msg = (err as Error)?.message ?? '';
    // Our own messages (newer schema, lock timeout) are safe; raw driver text is not.
    if (/created by a newer OpsDesk|migration lock/.test(msg)) throw new DatabaseConfigError(msg);
    throw new DatabaseConfigError(
      settings.client === 'sqlite' ? `Could not open or migrate the SQLite database: ${msg.slice(0, 120)}` : `Database migration failed${safeCode(err)}. The account needs permission to create tables.`,
    );
  }
  return db;
}

export { DatabaseConfigError } from './errors.js';
export type { Database, Executor, Dialect } from './types.js';
