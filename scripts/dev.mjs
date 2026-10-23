// Starts the API (tsx watch) and the Vite dev server together. Cross-platform.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
try {
  process.loadEnvFile(resolve(root, '.env')); // .env values never override variables that are already set
} catch {
  /* no .env: defaults and opsdesk.config.json apply */
}
const backendPort = process.env.OPSDESK_DEV_BACKEND_PORT ?? '4311';
const env = {
  ...process.env,
  OPSDESK_PORT: backendPort,
  OPSDESK_DATA_DIR: process.env.OPSDESK_DATA_DIR ?? resolve(root, '.dev-data'),
  OPSDESK_SERVE_WEB: '0',
};
const bin = (name) => resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const run = (cmd, args, extraEnv) =>
  spawn(cmd, args, { cwd: root, env: extraEnv ?? env, stdio: 'inherit', shell: process.platform === 'win32' });

const children = [
  run(bin('tsx'), ['watch', '--clear-screen=false', 'server/index.ts']),
  run(bin('vite'), []),
];
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { stop(); process.exit(code ?? 0); }));
console.log('\nOpsDesk dev: open http://localhost:5173  (API on 127.0.0.1:' + backendPort + ', data in ' + env.OPSDESK_DATA_DIR + ')\n');
