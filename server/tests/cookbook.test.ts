import { execFile, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN } from './contract.js';
import { cleanup, ENGINES, startServer, type TestServer } from './helpers.js';

const run = promisify(execFile);
const have = (cmd: string) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
const tools = have('bash') && have('curl') && have('jq');

const servers: TestServer[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await s.close();
    cleanup(s.dataDir);
  }
});

for (const engine of ENGINES) describe.skipIf(!tools)(`curl cookbook [${engine.name}]`, () => {
  it('docs/api/examples/cookbook.sh runs the complete workflow against a running server and leaves nothing behind', async () => {
    const s = await startServer({ engine, config: { apiToken: TOKEN } });
    servers.push(s);
    await s.api('POST', '/setup', { choice: 'empty' });
    const before = JSON.stringify((await s.api('GET', '/dashboard')).body.workspaces);
    const { stdout } = await run('bash', [resolve('docs/api/examples/cookbook.sh')], {
      env: { PATH: process.env.PATH!, HOME: process.env.HOME ?? '', BASE: `${s.base}/api/v1`, OPSDESK_API_TOKEN: TOKEN, COOKBOOK_ALLOW_REPLACE: '1' },
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    expect(stdout).toContain('COOKBOOK OK');
    expect(stdout).not.toContain(TOKEN);
    const after = (await s.api('GET', '/dashboard')).body.workspaces;
    expect(JSON.stringify(after)).toBe(before); // all demo resources were deleted again
  }, 130_000);

  it('the script is safe by construction: no tracing, token only through a private header file', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(resolve('docs/api/examples/cookbook.sh'), 'utf8');
    expect(text).not.toMatch(/^\s*set\s+-[a-z]*x/m);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9]{20,}/);
    expect(text).toContain('-H @"$AUTHFILE"');
    expect(text).not.toMatch(/-H\s+["']Authorization: Bearer \$/); // never on the command line
  });
});
