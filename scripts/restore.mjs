// Restores the database from a backup file. Stop OpsDesk first.
// Usage: npm run restore -- <path-to-backup.sqlite>
// The current database is saved as backups/pre-restore-<timestamp>.sqlite before it is replaced.
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { validateBackupFile } from '../dist/server/backup.js';
import { loadConfig } from '../dist/server/config.js';

const source = process.argv[2] ? resolve(process.argv[2]) : null;
if (!source || !existsSync(source)) {
  console.error('Usage: npm run restore -- <path-to-backup.sqlite>   (the file must exist)');
  process.exit(1);
}
const config = loadConfig();
if (config.database.client !== 'sqlite') {
  console.error(
    `This command only restores the embedded SQLite file. The configured engine is ${config.database.client}: restore with ` +
      (config.database.client === 'postgres' ? 'pg_restore / psql' : 'mysql < dump.sql') + ' (see the documentation: Operations, Backup and restore), or import a JSON export.',
  );
  process.exit(1);
}
const inUse = await new Promise((done) => {
  const s = net.connect({ port: config.port, host: '127.0.0.1' }, () => { s.destroy(); done(true); });
  s.on('error', () => done(false));
});
if (inUse) {
  console.error(`Something is listening on port ${config.port}. Stop OpsDesk before restoring, then run this command again.`);
  process.exit(1);
}
try {
  validateBackupFile(source);
} catch (e) {
  console.error(`Not a valid OpsDesk backup: ${e.message}`);
  process.exit(1);
}
const dbPath = config.database.sqlitePath;
mkdirSync(join(config.dataDir, 'backups'), { recursive: true });
if (existsSync(dbPath)) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
  const safety = join(config.dataDir, 'backups', `pre-restore-${stamp}.sqlite`);
  const db = new DatabaseSync(dbPath);
  db.prepare('VACUUM INTO ?').run(safety);
  db.close();
  console.log(`Current data saved to ${safety}`);
}
const tmp = `${dbPath}.restoring`;
copyFileSync(source, tmp);
renameSync(tmp, dbPath);
rmSync(`${dbPath}-journal`, { force: true });
console.log(`Restored ${source} -> ${dbPath}. Start OpsDesk again.`);
