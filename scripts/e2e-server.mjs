// Starts the built server on fresh data for the Playwright end-to-end test.
// Engine comes from the environment (OPSDESK_DB_CLIENT / OPSDESK_DATABASE_URL); PostgreSQL/MySQL tables are dropped first.
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(import.meta.dirname, '..', 'test-results', 'e2e-data');
rmSync(dir, { recursive: true, force: true });
process.env.OPSDESK_DATA_DIR = dir;
process.env.OPSDESK_PORT = '4391';
// Test-only credentials for the Swagger/API browser tests (never used outside the e2e run).
process.env.OPSDESK_API_TOKEN = 'e2e-api-token-0123456789abcdefghijklmnop';
process.env.OPSDESK_CORS_ORIGINS = 'http://127.0.0.1:4399'; // origin of the standalone docs-preview test server

const { loadConfig } = await import('../dist/server/config.js');
const config = loadConfig();
if (config.database.client !== 'sqlite') {
  const { openDatabase } = await import('../dist/server/db/index.js');
  const db = await openDatabase(config.database);
  for (const t of ['health_probe', 'bookmarks', 'bookmark_groups', 'workspaces', 'meta', 'schema_migrations']) await db.exec(`DROP TABLE IF EXISTS ${t}`);
  await db.close();
}
await import('../dist/server/index.js');
