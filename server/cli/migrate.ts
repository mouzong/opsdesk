// npm run db:migrate - creates the data directory, connects to the configured database and applies pending migrations.
// (The server does the same automatically at every start-up; this command is for running it separately.)
import { mkdirSync } from 'node:fs';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { migrationStatus } from '../db/migrate.js';

try {
  const config = loadConfig();
  mkdirSync(config.dataDir, { recursive: true });
  const db = await openDatabase(config.database); // connects and applies pending migrations
  const status = await migrationStatus(db);
  await db.close();
  console.log(`Database (${config.database.client}) is up to date: schema version ${status.current} of ${status.latest}, ${status.pending} pending.`);
} catch (err) {
  console.error(`Migration problem: ${(err as Error).message}`);
  process.exit(1);
}
