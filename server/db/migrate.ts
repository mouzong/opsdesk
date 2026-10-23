import type { Database, Executor } from './types.js';
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './migrations.js';

const TABLE_DDL = `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, applied_at VARCHAR(40) NOT NULL)`;

export interface MigrationStatus {
  /** Highest applied version as a string ("0" when nothing is applied) - same representation on every engine. */
  current: string;
  latest: string;
  pending: number;
}

async function tableExists(db: Executor): Promise<boolean> {
  const sql =
    db.dialect === 'sqlite' ? `SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`
    : db.dialect === 'postgres' ? `SELECT table_name AS n FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`
    : `SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'`;
  return (await db.query(sql)).length > 0;
}

async function appliedVersions(db: Executor): Promise<number[]> {
  return (await db.query('SELECT version FROM schema_migrations ORDER BY version')).map((r) => Number(r.version));
}

/** SQLite files written before schema_migrations existed track their version in PRAGMA user_version. */
async function adoptLegacySqlite(db: Executor): Promise<void> {
  const legacy = Number((await db.query('PRAGMA user_version'))[0]?.user_version ?? 0);
  const stamp = new Date().toISOString();
  for (const m of MIGRATIONS.filter((x) => x.version <= legacy)) {
    await db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, stamp]);
  }
}

export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialise concurrent starters (rare, but a second instance must never half-apply a migration).
    if (tx.dialect === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(727274)');
    let locked = false;
    if (tx.dialect === 'mysql') {
      const got = await tx.query(`SELECT GET_LOCK('opsdesk_migrate', 60) AS l`);
      locked = Number(got[0]?.l) === 1;
      if (!locked) throw new Error('Could not obtain the migration lock; is another OpsDesk instance starting?');
    }
    try {
      const existed = await tableExists(tx);
      if (!existed) {
        await tx.exec(TABLE_DDL);
        if (tx.dialect === 'sqlite') await adoptLegacySqlite(tx);
      }
      const applied = new Set(await appliedVersions(tx));
      const max = Math.max(0, ...applied);
      if (max > LATEST_SCHEMA_VERSION) {
        throw new Error(`The database was created by a newer OpsDesk (schema ${max}, this build supports ${LATEST_SCHEMA_VERSION}). Update OpsDesk or use another database.`);
      }
      for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        for (const stmt of m.statements[tx.dialect]) await tx.exec(stmt);
        await tx.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
      }
    } finally {
      if (locked) await tx.query(`SELECT RELEASE_LOCK('opsdesk_migrate') AS l`).catch(() => undefined);
    }
  });
}

/** Read-only view used by the health check. */
export async function migrationStatus(db: Executor): Promise<MigrationStatus> {
  const applied = await appliedVersions(db);
  const current = Math.max(0, ...applied);
  const pending = MIGRATIONS.filter((m) => !applied.includes(m.version)).length;
  return { current: String(current), latest: String(LATEST_SCHEMA_VERSION), pending };
}
