// Cross-platform helper for the MkDocs documentation toolchain (Python is needed ONLY for this; the app itself is Node).
//   node scripts/docs.mjs setup   create .venv-docs and install the pinned requirements
//   node scripts/docs.mjs build   mkdocs build --strict  ->  dist/docs  (served by OpsDesk under /docs/)
//   node scripts/docs.mjs serve   live-reload preview on http://127.0.0.1:8000
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const venv = resolve(root, '.venv-docs');
const win = process.platform === 'win32';
const venvPython = resolve(venv, win ? 'Scripts/python.exe' : 'bin/python');
const [cmd, ...rest] = process.argv.slice(2);

function run(bin, args) {
  // NO_MKDOCS_2_WARNING silences Material's upstream announcement banner; the pinned MkDocs 1.x is unaffected by it.
  const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NO_MKDOCS_2_WARNING: 'true' } });
  if (r.error) {
    console.error(`Could not run "${bin}": ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function findSystemPython() {
  for (const c of win ? ['py', 'python', 'python3'] : ['python3', 'python']) {
    const r = spawnSync(c, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });
    if (r.status === 0) {
      const [maj, min] = r.stdout.trim().split('.').map(Number);
      if (maj === 3 && min >= 10) return c;
      console.error(`${c} is Python ${r.stdout.trim()}; Python 3.10 or newer is required for the documentation toolchain.`);
    }
  }
  console.error('No suitable Python 3.10+ found on PATH. Python is required only to build the documentation (https://www.python.org/downloads/).');
  process.exit(1);
}

if (cmd === 'setup') {
  if (!existsSync(venvPython)) run(findSystemPython(), ['-m', 'venv', venv]);
  run(venvPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'requirements-docs.txt']);
  console.log('Documentation toolchain ready (.venv-docs). Next: npm run docs:build');
} else if (cmd === 'build' || cmd === 'serve') {
  if (!existsSync(venvPython)) {
    console.error('Documentation toolchain not installed. Run: npm run docs:setup');
    process.exit(1);
  }
  // The API contract and coverage table are generated from the server code before every docs build/preview.
  if (spawnSync('npm', ['run', '--silent', 'api:spec'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).status !== 0) {
    console.error('Could not generate docs/api/openapi.json (run npm ci first).');
    process.exit(1);
  }
  const args = cmd === 'build' ? ['build', '--strict'] : ['serve', '--dev-addr', '127.0.0.1:8000', '--strict'];
  run(venvPython, ['-m', 'mkdocs', ...args, ...rest]);
} else {
  console.error('Usage: node scripts/docs.mjs <setup|build|serve>');
  process.exit(1);
}
