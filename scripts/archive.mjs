// Creates distributable archives of the source (no node_modules, no build output, no user data).
// Needs a `tar` on PATH (macOS, Linux and Windows 10+ all ship one).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const out = resolve(root, 'release');
mkdirSync(out, { recursive: true });
const excludes = ['node_modules', 'dist', 'release', 'data', '.dev-data', 'test-results', 'playwright-report', '.DS_Store', 'opsdesk.config.json', '.venv-docs', '.env'];
const flags = excludes.flatMap((e) => ['--exclude', e]);
const dir = basename(root);
const parent = resolve(root, '..');

function tar(args) {
  return spawnSync('tar', args, { stdio: ['ignore', 'ignore', 'ignore'] }).status === 0;
}
function create(file, extra) {
  const base = [...extra, ...flags, '-C', parent, dir];
  // bsdtar (macOS/Windows) renames with -s; GNU tar (Linux) uses --transform.
  return tar(['-s', `,^${dir},opsdesk-${version},`, '-cf', file, ...base].filter(Boolean))
    || tar(['--transform', `s,^${dir},opsdesk-${version},`, '-cf', file, ...base]);
}
const gz = resolve(out, `opsdesk-${version}.tar.gz`);
const zip = resolve(out, `opsdesk-${version}.zip`);
console.log(create(gz, ['-z']) ? `Created ${gz}` : 'tar.gz creation failed');
console.log(create(zip, ['-a']) ? `Created ${zip}` : 'zip creation is not supported by this tar - use the .tar.gz');
