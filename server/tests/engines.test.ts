import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, ENGINES, startServer, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await s.close();
    cleanup(s.dataDir);
  }
});
const boot = async (engine: (typeof ENGINES)[number], opts: Parameters<typeof startServer>[0] = {}) => {
  const s = await startServer({ engine, ...opts });
  servers.push(s);
  return s;
};
const normalise = (exp: any) => ({ ...exp, exportedAt: undefined });

async function populate(s: TestServer) {
  await s.api('POST', '/setup', { choice: 'empty' });
  const w = (await s.api('POST', '/workspaces', { name: 'Observabilité', icon: 'activity' })).body;
  const g1 = (await s.api('POST', `/workspaces/${w.id}/groups`, { name: 'Elastic' })).body;
  const g2 = (await s.api('POST', `/workspaces/${w.id}/groups`, { name: 'Métriques' })).body;
  await s.api('POST', `/groups/${g1.id}/bookmarks`, { title: 'Kibana 🚀', url: 'https://kibana.example.org:5601/app#/x', environment: 'production', tags: ['elastic', 'logs'], favorite: true, owner: 'Équipe', note: 'ligne1\nligne2', icon: 'search', description: 'd' });
  await s.api('POST', `/groups/${g1.id}/bookmarks`, { title: 'APM', url: 'https://apm.example.org/', environment: 'staging' });
  await s.api('POST', `/groups/${g2.id}/bookmarks`, { title: 'Grafana', url: 'https://grafana.example.org/' });
  await s.api('PATCH', `/groups/${g2.id}`, { collapsed: true });
  await s.api('POST', '/workspaces', { name: 'Infra', icon: 'server' });
  await s.api('PATCH', '/settings', { title: 'Bureau N2' });
}

describe('moving data between engines with the portable JSON export/import', () => {
  const external = ENGINES.filter((e) => e.name !== 'sqlite');
  if (external.length === 0) it.skip('needs TEST_POSTGRES_URL and/or TEST_MYSQL_URL', () => undefined);
  for (const target of external) {
    it(`sqlite -> ${target.name} -> sqlite keeps content, order, groups, flags and title`, async () => {
      const a = await boot({ name: 'sqlite' });
      await populate(a);
      const exp1 = await (await fetch(`${a.base}/api/export`)).json();

      const b = await boot(target);
      const r = await b.api('POST', '/import/apply', { source: 'json', data: exp1, mode: 'replace', confirmReplace: true });
      expect(r.status).toBe(200);
      const exp2 = await (await fetch(`${b.base}/api/export`)).json();
      // timestamps are carried over, so the documents are identical apart from exportedAt
      expect(normalise(exp2)).toEqual(normalise(exp1));

      const c = await boot({ name: 'sqlite' });
      await c.api('POST', '/import/apply', { source: 'json', data: exp2, mode: 'replace', confirmReplace: true });
      const exp3 = await (await fetch(`${c.base}/api/export`)).json();
      expect(normalise(exp3)).toEqual(normalise(exp1));
      // what the export does NOT carry: recent-open history and sample flags
      const dash = (await c.api('GET', '/dashboard')).body;
      expect(dash.recent).toEqual([]);
    });
  }
});

describe('secrets never reach the browser', () => {
  const external = ENGINES.filter((e) => e.name !== 'sqlite');
  for (const engine of external) {
    it(`[${engine.name}] API responses and served pages contain no credentials, URL or host`, async () => {
      const url = new URL(engine.url!);
      const needles = [decodeURIComponent(url.password), engine.url!, `${url.protocol}//`, url.host, url.username + ':'];
      const webDir = join(process.cwd(), 'dist', 'web');
      const s = await boot(engine, { config: { serveWeb: true }, app: { webDir } });
      await populate(s);
      const bodies: string[] = [];
      for (const path of ['/session', '/dashboard', '/health', '/export', '/backups']) bodies.push(await (await fetch(`${s.base}/api${path}`)).text());
      bodies.push((await s.api('POST', '/groups/nope/bookmarks', { title: 'x', url: 'https://x.example.org' })).body.error.message);
      bodies.push(JSON.stringify((await s.api('POST', '/import/preview', { source: 'json', data: { format: 'x' } })).body));
      bodies.push(await (await fetch(`${s.base}/`)).text());
      for (const b of bodies) for (const n of needles) expect(b.includes(n), n).toBe(false);
    });
  }

  it('the compiled frontend bundle contains no connection strings or credentials (needs `npm run build`)', () => {
    const dir = join(process.cwd(), 'dist', 'web');
    let files: string[] = [];
    try {
      const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
      files = walk(dir).filter((f) => /\.(js|css|html|svg|json)$/.test(f));
    } catch {
      return; // not built in this environment
    }
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(/postgres(ql)?:\/\/[^\s"']*@|mysql:\/\/[^\s"']*@|PGPASSWORD|MYSQL_PWD|testpw/i.test(text), f).toBe(false);
    }
  });
});
