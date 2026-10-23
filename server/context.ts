import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Config } from './config.js';
import { openDatabase } from './db/index.js';
import type { Database } from './db/types.js';

export interface AppContext {
  config: Config;
  csrfToken: string;
  readonly db: Database;
  /** SQLite file path ('' for PostgreSQL/MySQL). */
  readonly dbPath: string;
  readonly backupDir: string;
  readonly engine: Config['database']['client'];
  closeDb(): Promise<void>;
  reopenDb(): Promise<void>;
}

export async function createContext(config: Config): Promise<AppContext> {
  let db: Database | null = await openDatabase(config.database);
  return {
    config,
    csrfToken: randomBytes(32).toString('hex'),
    get db() {
      if (!db) throw new Error('Database is closed');
      return db;
    },
    dbPath: config.database.client === 'sqlite' ? config.database.sqlitePath : '',
    backupDir: join(config.dataDir, 'backups'),
    engine: config.database.client,
    async closeDb() {
      const d = db;
      db = null;
      await d?.close();
    },
    async reopenDb() {
      const d = db;
      db = null;
      await d?.close();
      db = await openDatabase(config.database);
    },
  };
}
