import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, ENGINES, startServer, type TestServer } from './helpers.js';

for (const engine of ENGINES) describe(`HTTP API [${engine.name}]`, () => {
const servers: TestServer[] = [];
const dirs: string[] = [];
async function boot(opts: Parameters<typeof startServer>[0] = {}) {
  const s = await startServer({ engine, ...opts });
  servers.push(s);
  dirs.push(s.dataDir);
  return s;
}
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
  while (dirs.length) cleanup(dirs.pop()!);
});

async function setupBasic(s: TestServer) {
  await s.api('POST', '/setup', { choice: 'empty' });
  const ws = (await s.api('POST', '/workspaces', { name: 'Ops' })).body;
  const g = (await s.api('POST', `/workspaces/${ws.id}/groups`, { name: 'Tools' })).body;
  return { ws, g };
}
const flat = async (s: TestServer) => {
  const d = (await s.api('GET', '/dashboard')).body;
  return d.workspaces.flatMap((w: any) => w.groups.flatMap((g: any) => g.bookmarks.map((b: any) => ({ ...b, ws: w.name, group: g.name }))));
};

describe('URL and text safety', () => {
  it('rejects unsafe or invalid URL schemes server-side', async () => {
    const s = await boot();
    const { g } = await setupBasic(s);
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'vbscript:x', 'ftp://example.org/x', '//example.org', 'example.org', 'https://user:pass@example.org/', 'https://exa mple.org', '']) {
      const r = await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'x', url });
      expect(r.status, url).toBe(400);
      expect(r.body.error.fields.url).toBeTruthy();
    }
    const upd = await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'ok', url: 'https://ok.example.org' });
    expect((await s.api('PATCH', `/bookmarks/${upd.body.id}`, { url: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('accepts internal hosts, ports, paths, queries and fragments', async () => {
    const s = await boot();
    const { g } = await setupBasic(s);
    for (const url of ['http://kibana:5601/app/discover#/?_g=(time:(from:now-15m))', 'https://10.0.0.5:8443/a/b?c=d', 'http://[::1]:3000/', 'https://grafana.corp.local/d/abc#panel-2']) {
      expect((await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'x', url })).status, url).toBe(201);
    }
    const b = (await flat(s)).find((x: any) => x.url.includes('kibana'));
    expect(b.url).toBe('http://kibana:5601/app/discover#/?_g=(time:(from:now-15m))');
  });

  it('stores HTML-like text verbatim as plain text and returns it as JSON data', async () => {
    const s = await boot();
    const { g } = await setupBasic(s);
    const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const r = await s.api('POST', `/groups/${g.id}/bookmarks`, { title: evil, url: 'https://a.example.org', description: evil, note: evil, owner: evil, tags: ['<b>x</b>'] });
    expect(r.status).toBe(201);
    const b = (await flat(s))[0];
    expect(b).toMatchObject({ title: evil, description: evil, note: evil });
    expect(r.headers.get('content-type')).toMatch(/application\/json/);
    expect(r.headers.get('content-security-policy')).toMatch(/script-src 'self'/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('enforces field limits', async () => {
    const s = await boot();
    const { g } = await setupBasic(s);
    expect((await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'x'.repeat(121), url: 'https://a.example.org' })).status).toBe(400);
    expect((await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'x', url: 'https://a.example.org', note: 'n'.repeat(4001) })).status).toBe(400);
    expect((await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'x', url: 'https://a.example.org', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).status).toBe(400);
  });
});

describe('cross-origin protection', () => {
  it('rejects mutations from other origins, without token, wrong content type, and foreign Host headers', async () => {
    const s = await boot();
    const body = JSON.stringify({ name: 'Evil' });
    const headers = { 'content-type': 'application/json', 'x-csrf-token': s.csrf };
    const evilOrigin = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example.com' }, body });
    expect(evilOrigin.status).toBe(403);
    const lookalike = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...headers, origin: `http://localhost:${s.port + 1}` }, body });
    expect(lookalike.status).toBe(403);
    const noToken = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.base }, body });
    expect(noToken.status).toBe(401); // no CSRF token and no bearer token: authentication required
    const badToken = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s.base, 'x-csrf-token': 'nope' }, body });
    expect(badToken.status).toBe(403);
    const formPost = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { 'content-type': 'text/plain', origin: s.base, 'x-csrf-token': s.csrf }, body });
    expect(formPost.status).toBe(415);
    const crossSite = await fetch(`${s.base}/api/workspaces`, { method: 'POST', headers: { ...headers, origin: s.base, 'sec-fetch-site': 'cross-site' }, body });
    expect(crossSite.status).toBe(403);
    const cross = await fetch(`${s.base}/api/dashboard`, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    const options = await fetch(`${s.base}/api/workspaces`, { method: 'OPTIONS', headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' } });
    expect(options.status).toBe(405);
    expect(options.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await s.api('GET', '/dashboard');
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
    // nothing was created by any rejected request
    expect(ok.body.workspaces).toHaveLength(0);
  });

  it('rejects a foreign Host header (DNS rebinding) via a raw request', async () => {
    const s = await boot();
    const http = await import('node:http');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, path: '/api/session', headers: { host: `evil.example.com:${s.port}` } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe('persistence across restart', () => {
  it('keeps data, ordering and the setup choice after the server is stopped and started again', async () => {
    const s1 = await boot();
    const { g } = await setupBasic(s1);
    const ids: string[] = [];
    for (const t of ['A', 'B', 'C']) ids.push((await s1.api('POST', `/groups/${g.id}/bookmarks`, { title: t, url: `https://${t}.example.org` })).body.id);
    await s1.api('POST', `/bookmarks/${ids[2]}/move`, { groupId: g.id, index: 0 });
    await s1.api('PATCH', '/settings', { title: 'My Desk' });
    const dir = s1.dataDir;
    await s1.close();
    servers.splice(servers.indexOf(s1), 1);

    const s2 = await boot({ dataDir: dir, reset: false });
    const d = (await s2.api('GET', '/dashboard')).body;
    expect(d.title).toBe('My Desk');
    expect(d.setup).toBe('done');
    expect(d.workspaces[0].groups[0].bookmarks.map((b: any) => b.title)).toEqual(['C', 'A', 'B']);
    expect((await s2.api('POST', '/setup', { choice: 'sample' })).status).toBe(409); // sample can never be re-inserted
  });
});

describe('JSON export / import', () => {
  async function populated(s: TestServer) {
    const { ws, g } = await setupBasic(s);
    const g2 = (await s.api('POST', `/workspaces/${ws.id}/groups`, { name: 'Docs' })).body;
    await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'Kibana', url: 'https://kibana.example.org:5601/', environment: 'production', tags: ['elastic'], favorite: true, owner: 'Obs', note: 'n1', icon: 'search', description: 'd' });
    await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'Grafana', url: 'https://grafana.example.org/', environment: 'staging' });
    await s.api('POST', `/groups/${g2.id}/bookmarks`, { title: 'Runbook', url: 'https://wiki.example.org/n2#top' });
    await s.api('POST', '/workspaces', { name: 'Second', icon: 'rocket' });
  }

  it('round-trips through export then replace-import', async () => {
    const a = await boot();
    await populated(a);
    const exp = await (await fetch(`${a.base}/api/export`)).json();
    expect(exp).toMatchObject({ format: 'opsdesk-export', version: 1 });
    const before = (await a.api('GET', '/dashboard')).body;

    const b = await boot();
    await b.api('POST', '/setup', { choice: 'sample' });
    const refused = await b.api('POST', '/import/apply', { source: 'json', data: exp, mode: 'replace' });
    expect(refused.status).toBe(400); // needs confirmation
    const preview = await b.api('POST', '/import/preview', { source: 'json', data: exp, mode: 'replace' });
    expect(preview.body.counts).toMatchObject({ bookmarksAdded: 3, workspacesAdded: 2, workspacesRemoved: 5 });
    expect((await b.api('GET', '/dashboard')).body.workspaces).toHaveLength(5); // preview changed nothing
    const applied = await b.api('POST', '/import/apply', { source: 'json', data: exp, mode: 'replace', confirmReplace: true });
    expect(applied.status).toBe(200);
    expect(applied.body.backup).toMatch(/^pre-import-.*\.(sqlite|json)$/);
    expect(existsSync(join(b.dataDir, 'backups', applied.body.backup))).toBe(true);

    const after = (await b.api('GET', '/dashboard')).body;
    const strip = (d: any) => d.workspaces.map((w: any) => ({ name: w.name, icon: w.icon, groups: w.groups.map((g: any) => ({ name: g.name, bookmarks: g.bookmarks.map(({ id, groupId, isSample, lastOpenedAt, ...rest }: any) => rest) })) }));
    expect(strip(after)).toEqual(strip(before));
    expect(after.title).toBe(before.title);
  });

  it('merge: adds new, skips duplicates by default, updates when asked, matches names case-insensitively', async () => {
    const s = await boot();
    await populated(s);
    const file = {
      format: 'opsdesk-export', version: 1,
      workspaces: [{ name: 'ops', groups: [
        { name: 'tools', bookmarks: [
          { title: 'Kibana RENAMED', url: 'https://kibana.example.org:5601', environment: 'preproduction' }, // same URL (normalised)
          { title: 'Prometheus', url: 'https://prom.example.org/' },
        ] },
        { name: 'Brand new group', bookmarks: [{ title: 'Jenkins', url: 'https://jenkins.example.org/' }] },
      ] }, { name: 'New WS', groups: [] }],
    };
    const p1 = await s.api('POST', '/import/preview', { source: 'json', data: file, mode: 'merge' });
    expect(p1.body.counts).toMatchObject({ workspacesExisting: 1, workspacesAdded: 1, groupsExisting: 1, groupsAdded: 1, bookmarksAdded: 2, bookmarksSkipped: 1, bookmarksUpdated: 0 });
    await s.api('POST', '/import/apply', { source: 'json', data: file, mode: 'merge' });
    let all = await flat(s);
    expect(all.find((b: any) => b.url.includes('kibana')).title).toBe('Kibana'); // untouched
    expect(all).toHaveLength(5);
    expect((await s.api('GET', '/dashboard')).body.workspaces.map((w: any) => w.name)).toEqual(['Ops', 'Second', 'New WS']);

    const p2 = await s.api('POST', '/import/apply', { source: 'json', data: file, mode: 'merge', duplicates: 'update' });
    expect(p2.body.preview.counts).toMatchObject({ bookmarksUpdated: 3, bookmarksAdded: 0 });
    all = await flat(s);
    expect(all.find((b: any) => b.url.includes('kibana'))).toMatchObject({ title: 'Kibana RENAMED', environment: 'preproduction' });
    expect(all).toHaveLength(5); // no duplicates created
  });

  it('rejects invalid imports without touching existing data', async () => {
    const s = await boot();
    await populated(s);
    const before = JSON.stringify((await s.api('GET', '/dashboard')).body);
    const bads: unknown[] = [
      { format: 'something-else', version: 1, workspaces: [] },
      { format: 'opsdesk-export', version: 99, workspaces: [] },
      { format: 'opsdesk-export', version: 1, workspaces: [{ name: 'W', groups: [{ name: 'G', bookmarks: [{ title: 'ok', url: 'https://ok.example.org' }, { title: 'bad', url: 'javascript:alert(1)' }] }] }] },
      { format: 'opsdesk-export', version: 1, workspaces: 'nope' },
      'not an object',
    ];
    for (const data of bads) {
      for (const mode of ['merge', 'replace']) {
        const r = await s.api('POST', '/import/apply', { source: 'json', data, mode, confirmReplace: true });
        expect(r.status, JSON.stringify(data)).toBe(400);
      }
    }
    expect(JSON.stringify((await s.api('GET', '/dashboard')).body)).toBe(before);
  });

  it('rolls back everything when a valid import fails halfway', async () => {
    let calls = 0;
    const s = await boot({ app: { importHooks: { afterBookmark: () => { if (++calls === 2) throw new Error('simulated failure'); } } } });
    await populated(s);
    const before = JSON.stringify((await s.api('GET', '/dashboard')).body);
    const file = { format: 'opsdesk-export', version: 1, workspaces: [{ name: 'Fresh', groups: [{ name: 'G', bookmarks: [
      { title: 'one', url: 'https://one.example.org' }, { title: 'two', url: 'https://two.example.org' }, { title: 'three', url: 'https://three.example.org' }] }] }] };
    const r = await s.api('POST', '/import/apply', { source: 'json', data: file, mode: 'replace', confirmReplace: true });
    expect(r.status).toBe(500);
    expect(JSON.stringify((await s.api('GET', '/dashboard')).body)).toBe(before);
  });

  it('enforces the request size limit', async () => {
    const s = await boot();
    const huge = 'x'.repeat(8 * 1024 * 1024);
    const r = await s.api('POST', '/import/preview', { source: 'html', html: huge });
    expect(r.status).toBe(413);
  });
});

describe('browser bookmark HTML import', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1>
<DL><p>
  <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
  <DL><p>
    <DT><A HREF="https://kibana.example.org:5601/" ADD_DATE="1700000000" TAGS="elastic,logs">Kibana &amp; friends</A>
    <DD>The log tool
    <DT><H3>Nested</H3>
    <DL><p>
      <DT><A HREF="http://grafana.example.org/d/1#x">Grafana</A>
      <DT><A HREF="javascript:alert(1)">Evil</A>
      <DT><A HREF="place:sort=8">Firefox</A>
    </DL><p>
  </DL><p>
  <DT><A HREF="https://root.example.org/"><script>alert(1)</script>Root link</A>
</DL><p>`;

  it('parses folders, tags, entities and descriptions; skips non-http(s) links', async () => {
    const s = await boot();
    await s.api('POST', '/setup', { choice: 'empty' });
    const p = await s.api('POST', '/import/preview', { source: 'html', html, workspaceName: 'From Chrome' });
    expect(p.status).toBe(200);
    expect(p.body.counts).toMatchObject({ workspacesAdded: 1, groupsAdded: 3, bookmarksAdded: 3 });
    expect(p.body.warnings.join(' ')).toMatch(/2 link\(s\) skipped/);
    const r = await s.api('POST', '/import/apply', { source: 'html', html, workspaceName: 'From Chrome' });
    expect(r.status).toBe(200);
    const all = await flat(s);
    expect(all.map((b: any) => [b.group, b.title])).toEqual(expect.arrayContaining([
      ['Bookmarks bar', 'Kibana & friends'], ['Bookmarks bar / Nested', 'Grafana'],
    ]));
    const kib = all.find((b: any) => b.title.startsWith('Kibana'));
    expect(kib.tags).toEqual(['elastic', 'logs']);
    expect(kib.description).toBe('The log tool');
    expect(all.some((b: any) => /javascript|place:/.test(b.url))).toBe(false);
    // second import is idempotent (duplicates skipped by URL)
    const again = await s.api('POST', '/import/apply', { source: 'html', html, workspaceName: 'From Chrome' });
    expect(again.body.preview.counts).toMatchObject({ bookmarksAdded: 0, bookmarksSkipped: 3 });
  });

  it('refuses files with nothing importable', async () => {
    const s = await boot();
    const r = await s.api('POST', '/import/preview', { source: 'html', html: '<html><body>hello</body></html>' });
    expect(r.status).toBe(400);
  });
});

describe.skipIf(engine.name !== 'sqlite')('backup and restore (SQLite file backups)', () => {
  it('creates consistent backups, restores them, and keeps a pre-restore safety copy', async () => {
    const s = await boot();
    const { g } = await setupBasic(s);
    await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'Keep me', url: 'https://keep.example.org' });
    const backup = (await s.api('POST', '/backups')).body;
    expect(backup.name).toMatch(/^manual-.*\.sqlite$/);
    await s.api('POST', `/groups/${g.id}/bookmarks`, { title: 'Added later', url: 'https://later.example.org' });
    expect(await flat(s)).toHaveLength(2);

    expect((await s.api('POST', `/backups/${backup.name}/restore`, {})).status).toBe(400); // needs confirm
    const restored = await s.api('POST', `/backups/${backup.name}/restore`, { confirm: true });
    expect(restored.status).toBe(200);
    expect((await flat(s)).map((b: any) => b.title)).toEqual(['Keep me']);
    const list = (await s.api('GET', '/backups')).body.items;
    expect(list.map((b: any) => b.kind)).toEqual(expect.arrayContaining(['manual', 'pre-restore']));
    // the app still writes after a restore
    expect((await s.api('POST', `/groups/${(await s.api('GET', '/dashboard')).body.workspaces[0].groups[0].id}/bookmarks`, { title: 'After', url: 'https://after.example.org' })).status).toBe(201);
    const dl = await fetch(`${s.base}/api/backups/${backup.name}/download`);
    expect(dl.status).toBe(200);
    expect((await dl.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('rejects corrupt files, path traversal and unknown names', async () => {
    const s = await boot();
    await setupBasic(s);
    mkdirIfNeeded(join(s.dataDir, 'backups'));
    writeFileSync(join(s.dataDir, 'backups', 'broken.sqlite'), 'this is not sqlite');
    const r = await s.api('POST', '/backups/broken.sqlite/restore', { confirm: true });
    expect(r.status).toBe(400);
    expect((await s.api('GET', '/dashboard')).body.workspaces).toHaveLength(1);
    for (const name of ['..%2F..%2Fopsdesk.sqlite', '..%5Copsdesk.sqlite', 'nope.sqlite']) {
      const x = await s.api('POST', `/backups/${name}/restore`, { confirm: true });
      expect([400, 404]).toContain(x.status);
    }
    expect(readdirSync(s.dataDir)).toContain('opsdesk.sqlite');
  });

  it('prunes automatic backups to the configured count', async () => {
    const s = await boot();
    const { createBackup } = await import('../backup.js');
    for (let i = 0; i < 5; i++) { await createBackup(s.ctx, 'auto'); await new Promise((r) => setTimeout(r, 3)); }
    expect((await s.api('GET', '/backups')).body.items.filter((b: any) => b.kind === 'auto')).toHaveLength(3);
  });
});
});

import { mkdirSync } from 'node:fs';
function mkdirIfNeeded(p: string) { mkdirSync(p, { recursive: true }); }
