// Creates a consistent snapshot of the database (safe while OpsDesk is running).
// Usage: npm run backup            -> <dataDir>/backups/manual-<timestamp>.sqlite
//        npm run backup -- <file>  -> any destination path you choose
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../dist/server/config.js';

const config = loadConfig();
if (config.database.client !== 'sqlite') {
  console.error(
    `This command only backs up the embedded SQLite file. The configured engine is ${config.database.client}: use ` +
      (config.database.client === 'postgres' ? 'pg_dump' : 'mysqldump') + ' (see the documentation: Operations, Backup and restore), or export JSON from Settings.',
  );
  process.exit(1);
}
const dbPath = config.database.sqlitePath;
if (!existsSync(dbPath)) {
  console.error(`No database found at ${dbPath}. Nothing to back up.`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
const target = process.argv[2] ? resolve(process.argv[2]) : join(config.dataDir, 'backups', `manual-${stamp}.sqlite`);
if (existsSync(target)) {
  console.error(`Refusing to overwrite existing file ${target}.`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
const partial = `${target}.partial`;
rmSync(partial, { force: true });
db.prepare('VACUUM INTO ?').run(partial);
db.close();
renameSync(partial, target);
console.log(`Backup written to ${target}`);
