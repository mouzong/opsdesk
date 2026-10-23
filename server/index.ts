import { describeDatabase, loadConfig } from './config.js';
import { createContext } from './context.js';
import { createApp } from './app.js';
import { startupBackup } from './backup.js';

try {
  const config = loadConfig();
  const ctx = await createContext(config);
  try {
    await startupBackup(ctx);
  } catch {
    console.warn('Warning: the automatic start-up backup could not be created.');
  }
  const app = createApp(ctx);
  const server = app.listen(config.port, config.host, () => {
    const shown = config.host.includes(':') ? `[${config.host}]` : config.host;
    console.log(`OpsDesk is running at http://${shown}:${config.port}`);
    const db = describeDatabase(config.database);
    console.log(`Database: ${db.label}${db.tls === null ? '' : db.tls ? ' (TLS)' : ' (no TLS)'}`);
    console.log(`Data directory: ${config.dataDir}`);
    if (config.database.ssl && !config.database.ssl.rejectUnauthorized) console.warn('WARNING: database TLS certificate verification is DISABLED (OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY=1).');
    if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
      console.warn('WARNING: bound to a non-loopback address. OpsDesk has no authentication.');
    }
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${config.port} is already in use. Set another port with OPSDESK_PORT (see README, Troubleshooting).`);
    else if (err.code === 'EACCES') console.error(`Not allowed to listen on port ${config.port}. Use a port above 1024.`);
    else console.error(`Server error: ${err.code ?? err.message}`);
    process.exit(1);
  });
  const shutdown = () => {
    server.close(() => {
      void ctx.closeDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error(`OpsDesk could not start: ${(err as Error).message}`);
  process.exit(1);
}
