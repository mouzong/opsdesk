// npm run config:check - validates .env / opsdesk.config.json and prints the effective, non-secret settings.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describeDatabase, loadConfig } from '../config.js';
import { VERSION } from '../version.js';

try {
  const config = loadConfig();
  const configFile = resolve(process.env.OPSDESK_CONFIG ?? 'opsdesk.config.json');
  const db = describeDatabase(config.database);
  console.log(`OpsDesk ${VERSION} - configuration OK`);
  console.log(`  config file : ${existsSync(configFile) ? configFile : 'none (defaults + environment only)'}`);
  console.log(`  listen      : http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`);
  console.log(`  data dir    : ${config.dataDir}`);
  console.log(`  database    : ${db.label}${config.database.client === 'sqlite' ? ` (${config.database.sqlitePath})` : db.tls ? ' (TLS on, certificates verified unless OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY=1)' : ' (TLS off)'}`);
  console.log(`  health      : timeout ${config.health.timeoutMs} ms, cache ${config.health.cacheMs / 1000} s`);
} catch (err) {
  console.error(`Configuration problem: ${(err as Error).message}`);
  process.exit(1);
}
