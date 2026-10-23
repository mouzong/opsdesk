// Writes dist/build-info.json at the end of `npm run build`. Only facts that exist are recorded:
//   version  from package.json (the authoritative release version)
//   builtAt  the actual time of this build
//   commit   short git SHA if the build runs inside a git checkout, or OPSDESK_COMMIT (e.g. Docker build arg); otherwise omitted
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function commit() {
  const fromEnv = (process.env.OPSDESK_COMMIT ?? '').trim();
  if (/^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.slice(0, 12);
  const r = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const out = (r.stdout ?? '').trim();
  return r.status === 0 && /^[0-9a-f]{7,40}$/i.test(out) ? out : undefined;
}

const info = { version, builtAt: new Date().toISOString(), ...(commit() ? { commit: commit() } : {}) };
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`build-info: v${info.version}, built ${info.builtAt}${info.commit ? `, commit ${info.commit}` : ' (no commit id available)'}`);
