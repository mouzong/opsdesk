import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BackupInfo } from '../shared/types.js';
import type { AppContext } from './context.js';
import { LATEST_SCHEMA_VERSION } from './db/migrations.js';
import { AppError, notFound } from './errors.js';
import { buildExport } from './importExport.js';
import { countAll } from './repo.js';

export type BackupKind = BackupInfo['kind'];
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.sqlite$/;

/** File-copy backups only make sense for the embedded SQLite file. */
function requireSqlite(ctx: AppContext): void {
  if (ctx.engine !== 'sqlite') {
    throw new AppError(409, 'not_supported', 'Database backups are managed with your PostgreSQL/MySQL tooling (see the documentation: Operations, Backup and restore). Use Export JSON for a portable copy.');
  }
}

function kindOf(name: string): BackupKind {
  if (name.startsWith('manual-')) return 'manual';
  if (name.startsWith('auto-')) return 'auto';
  if (name.startsWith('pre-import-')) return 'pre-import';
  if (name.startsWith('pre-restore-')) return 'pre-restore';
  return 'other';
}

export function backupPath(ctx: AppContext, name: string): string {
  requireSqlite(ctx);
  if (!SAFE_NAME.test(name)) throw new AppError(400, 'invalid_name', 'Invalid backup name.');
  return join(ctx.backupDir, name);
}

export function listBackups(ctx: AppContext): BackupInfo[] {
  requireSqlite(ctx);
  if (!existsSync(ctx.backupDir)) return [];
  return readdirSync(ctx.backupDir)
    .filter((n) => SAFE_NAME.test(n))
    .map((name) => {
      const st = statSync(join(ctx.backupDir, name));
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString(), kind: kindOf(name) };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('.', '');

/** Consistent snapshot using SQLite's VACUUM INTO (safe while the app is running). */
export async function createBackup(ctx: AppContext, kind: Exclude<BackupKind, 'other'>): Promise<BackupInfo> {
  requireSqlite(ctx);
  mkdirSync(ctx.backupDir, { recursive: true });
  const name = `${kind}-${stamp()}.sqlite`;
  const final = join(ctx.backupDir, name);
  const partial = `${final}.partial`;
  rmSync(partial, { force: true });
  await ctx.db.run('VACUUM INTO ?', [partial]);
  renameSync(partial, final);
  if (kind === 'auto') pruneAuto(ctx);
  const st = statSync(final);
  return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString(), kind };
}

/**
 * Safety copy taken before an import. SQLite: a database snapshot. PostgreSQL/MySQL: a portable JSON export
 * written to the local backups folder (restore it with Import > Replace).
 */
export async function createPreImportBackup(ctx: AppContext): Promise<string> {
  if (ctx.engine === 'sqlite') return (await createBackup(ctx, 'pre-import')).name;
  mkdirSync(ctx.backupDir, { recursive: true });
  const name = `pre-import-${stamp()}.json`;
  const partial = join(ctx.backupDir, `${name}.partial`);
  writeFileSync(partial, JSON.stringify(await buildExport(ctx.db), null, 2), { mode: 0o600 });
  renameSync(partial, join(ctx.backupDir, name));
  return name;
}

export function pruneAuto(ctx: AppContext): void {
  const autos = listBackups(ctx).filter((b) => b.kind === 'auto');
  for (const old of autos.slice(ctx.config.autoBackupKeep)) rmSync(join(ctx.backupDir, old.name), { force: true });
}

/** Called on start-up: keeps at least one automatic backup per 24 hours when there is data (SQLite only). */
export async function startupBackup(ctx: AppContext): Promise<void> {
  if (ctx.engine !== 'sqlite' || (await countAll(ctx.db)).bookmarks === 0) return;
  const newest = listBackups(ctx)[0];
  if (newest && Date.now() - Date.parse(newest.createdAt) < 24 * 3600 * 1000) return;
  await createBackup(ctx, 'auto');
}

export function deleteBackup(ctx: AppContext, name: string): void {
  const p = backupPath(ctx, name);
  if (!existsSync(p)) throw notFound('Backup');
  rmSync(p);
}

/** Opens the file read-only and verifies integrity, schema version and the expected tables. */
export function validateBackupFile(file: string): void {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw new AppError(400, 'invalid_backup', 'The file is not a readable SQLite database.');
  }
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new AppError(400, 'invalid_backup', 'The backup failed the SQLite integrity check.');
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['meta', 'workspaces', 'bookmark_groups', 'bookmarks']) {
      if (!tables.includes(t)) throw new AppError(400, 'invalid_backup', 'The file is not an OpsDesk backup.');
    }
    const version = tables.includes('schema_migrations')
      ? Number((db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v)
      : Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version > LATEST_SCHEMA_VERSION) throw new AppError(400, 'invalid_backup', 'The backup was created by a newer OpsDesk version.');
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'invalid_backup', 'The file is not a valid OpsDesk backup.');
  } finally {
    db.close();
  }
}

export async function restoreBackup(ctx: AppContext, name: string): Promise<{ safetyBackup: string }> {
  const src = backupPath(ctx, name);
  if (!existsSync(src)) throw notFound('Backup');
  validateBackupFile(src);
  const safety = await createBackup(ctx, 'pre-restore');
  const tmp = `${ctx.dbPath}.restoring`;
  await ctx.closeDb();
  try {
    copyFileSync(src, tmp);
    renameSync(tmp, ctx.dbPath);
    rmSync(`${ctx.dbPath}-journal`, { force: true });
    await ctx.reopenDb();
  } catch {
    rmSync(tmp, { force: true });
    // Put the previous data back so a failed restore never leaves the app without a database.
    try {
      copyFileSync(join(ctx.backupDir, safety.name), ctx.dbPath);
      await ctx.reopenDb();
    } catch {
      /* surfaced below */
    }
    throw new AppError(500, 'restore_failed', 'Restore failed; your previous data was put back.');
  }
  return { safetyBackup: safety.name };
}
