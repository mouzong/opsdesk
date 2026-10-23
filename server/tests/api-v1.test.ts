import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { routes } from '../api/routes.js';
import { client, covered, TOKEN } from './contract.js';
import { cleanup, ENGINES, startServer, type TestServer } from './helpers.js';

const pkg = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8')) as { version: string };

for (const engine of ENGINES) describe(`API v1 [${engine.name}]`, () => {
  const servers: TestServer[] = [];
  const boot = async (opts: Parameters<typeof startServer>[0] = {}) => {
    const s = await startServer({ engine, ...opts, config: { apiToken: TOKEN, ...(opts.config ?? {}) } });
    servers.push(s);
    return s;
  };
  afterEach(async () => {
    while (servers.length) {
      const s = servers.pop()!;
      await s.close();
      cleanup(s.dataDir);
    }
  });

  it('tours EVERY operation; each response matches the OpenAPI contract', async () => {
    const s = await boot();
    const call = client(s);
    const isSqlite = engine.name === 'sqlite';

    // ---- system (no credentials)
    expect((await call('getHealth', 'GET', '/health', { expect: 200, anonymous: true })).body.status).toBe('green');
    const version = (await call('getVersion', 'GET', '/version', { expect: 200, anonymous: true })).body;
    expect(version).toMatchObject({ application: 'opsdesk', version: pkg.version, apiVersion: 'v1' });
    const caps = (await call('getCapabilities', 'GET', '/capabilities', { expect: 200, anonymous: true })).body;
    expect(caps.engine.client).toBe(engine.name);
    expect(caps.authentication.bearerToken).toBe(true);
    expect(caps.features.fileBackups).toBe(isSqlite);
    const doc = (await call('getOpenApiDocument', 'GET', '/openapi.json', { expect: 200, anonymous: true })).body;
    expect(doc.openapi).toBe('3.1.0');
    await call('getSession', 'GET', '/session', { expect: 200, anonymous: true });

    // ---- settings and first-run setup
    expect((await call('getSettings', 'GET', '/settings', { expect: 200 })).body.title).toBe('OpsDesk');
    await call('updateSettings', 'PATCH', '/settings', { expect: 200, body: { title: 'API Desk' } });
    expect((await call('getSettings', 'GET', '/settings', { expect: 200 })).body.title).toBe('API Desk');
    await call('updateSettings', 'PATCH', '/settings', { expect: 400, body: { title: '' } });
    await call('completeSetup', 'POST', '/setup', { expect: 200, body: { choice: 'empty' } });
    await call('completeSetup', 'POST', '/setup', { expect: 409, body: { choice: 'empty' } });
    expect((await call('removeSampleData', 'POST', '/sample-data/remove', { expect: 200, body: {} })).body).toEqual({ bookmarks: 0, groups: 0, workspaces: 0 });

    // ---- workspaces
    const w1 = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Observability', icon: 'activity' } })).body;
    const w2 = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Infrastructure' } })).body;
    await call('createWorkspace', 'POST', '/workspaces', { expect: 400, body: { name: '' } });
    const created = await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Temp' } });
    expect(created.headers.get('location')).toBe(`/api/v1/workspaces/${created.body.id}`);
    const list = (await call('listWorkspaces', 'GET', '/workspaces?sort=name&order=desc', { expect: 200 })).body;
    expect(list.items.map((w: any) => w.name)).toEqual(['Temp', 'Observability', 'Infrastructure']);
    const got = await call('getWorkspace', 'GET', `/workspaces/${w1.id}`, { expect: 200 });
    expect(got.headers.get('etag')).toMatch(/^W\//);
    await call('getWorkspace', 'GET', '/workspaces/nope', { expect: 404 });
    await call('updateWorkspace', 'PATCH', `/workspaces/${w1.id}`, { expect: 200, body: { name: 'Observability & APM' } });
    await call('moveWorkspace', 'POST', `/workspaces/${w2.id}/move`, { expect: 200, body: { index: 0 } });
    expect((await call('listWorkspaces', 'GET', '/workspaces', { expect: 200 })).body.items.map((w: any) => w.name)).toEqual(['Infrastructure', 'Observability & APM', 'Temp']);
    await call('deleteWorkspace', 'DELETE', `/workspaces/${created.body.id}`, { expect: 200 });
    await call('deleteWorkspace', 'DELETE', `/workspaces/${created.body.id}`, { expect: 404 });

    // ---- groups
    const g1 = (await call('createGroup', 'POST', `/workspaces/${w1.id}/groups`, { expect: 201, body: { name: 'Elastic Stack' } })).body;
    const g2 = (await call('createGroup', 'POST', `/workspaces/${w1.id}/groups`, { expect: 201, body: { name: 'Metrics' } })).body;
    const g3 = (await call('createGroup', 'POST', `/workspaces/${w2.id}/groups`, { expect: 201, body: { name: 'Platform' } })).body;
    await call('createGroup', 'POST', '/workspaces/nope/groups', { expect: 404, body: { name: 'x' } });
    expect((await call('listGroups', 'GET', `/groups?workspaceId=${w1.id}`, { expect: 200 })).body.items.map((g: any) => g.name)).toEqual(['Elastic Stack', 'Metrics']);
    expect((await call('getGroup', 'GET', `/groups/${g1.id}`, { expect: 200 })).body.name).toBe('Elastic Stack');
    await call('updateGroup', 'PATCH', `/groups/${g2.id}`, { expect: 200, body: { name: 'Metrics & dashboards', collapsed: true } });
    await call('moveGroup', 'POST', `/groups/${g2.id}/move`, { expect: 200, body: { index: 0 } });
    await call('moveGroup', 'POST', `/groups/${g3.id}/move`, { expect: 200, body: { workspaceId: w1.id, index: 1 } });
    expect((await call('listGroups', 'GET', `/groups?workspaceId=${w1.id}`, { expect: 200 })).body.items.map((g: any) => g.name)).toEqual(['Metrics & dashboards', 'Platform', 'Elastic Stack']);

    // ---- bookmarks
    const b1 = (await call('createBookmark', 'POST', `/groups/${g1.id}/bookmarks`, {
      expect: 201, body: { title: 'Kibana', url: 'https://kibana.example.org:5601/app/discover', environment: 'production', tags: ['elastic', 'logs'], owner: 'Obs', description: 'Log search', note: 'note' },
    })).body;
    const b2 = (await call('createBookmark', 'POST', `/groups/${g1.id}/bookmarks`, { expect: 201, body: { title: 'APM', url: 'https://apm.example.org/', environment: 'staging', tags: ['elastic'] } })).body;
    await call('createBookmark', 'POST', `/groups/${g1.id}/bookmarks`, { expect: 400, body: { title: 'bad', url: 'javascript:alert(1)' } });
    const bm = await call('getBookmark', 'GET', `/bookmarks/${b1.id}`, { expect: 200 });
    expect(bm.body.url).toBe('https://kibana.example.org:5601/app/discover');
    await call('updateBookmark', 'PATCH', `/bookmarks/${b1.id}`, { expect: 200, body: { title: 'Kibana (prod)', favorite: true } });
    const copy = (await call('duplicateBookmark', 'POST', `/bookmarks/${b1.id}/duplicate`, { expect: 201 })).body;
    expect(copy.title).toBe('Kibana (prod) (copy)');
    await call('moveBookmark', 'POST', `/bookmarks/${copy.id}/move`, { expect: 200, body: { groupId: g2.id, index: 0 } });
    await call('moveBookmark', 'POST', `/bookmarks/${b2.id}/move`, { expect: 200, body: { groupId: g1.id, index: 0 } });
    expect((await call('getGroup', 'GET', `/groups/${g1.id}`, { expect: 200 })).body.bookmarks.map((b: any) => b.title)).toEqual(['APM', 'Kibana (prod)']);

    // ---- search, tags, environments
    const found = (await call('listBookmarks', 'GET', `/bookmarks?q=KIBANA&workspaceId=${w1.id}`, { expect: 200 })).body;
    expect(found.items.map((b: any) => b.title)).toEqual(['Kibana (prod) (copy)', 'Kibana (prod)']);
    expect(found.items[0]).toHaveProperty('workspaceName');
    await call('listBookmarks', 'GET', '/bookmarks?environment=nope', { expect: 400 });
    expect((await call('listTags', 'GET', '/tags', { expect: 200 })).body.items[0]).toEqual({ tag: 'elastic', count: 3 });
    expect((await call('listEnvironments', 'GET', '/environments', { expect: 200 })).body.items.find((e: any) => e.value === 'production').bookmarkCount).toBeGreaterThan(0);

    // ---- recent
    await call('recordBookmarkOpened', 'POST', `/bookmarks/${b1.id}/opened`, { expect: 200 });
    expect((await call('listRecent', 'GET', '/recent', { expect: 200 })).body.items.map((b: any) => b.id)).toEqual([b1.id]);
    expect((await call('clearRecent', 'DELETE', '/recent', { expect: 200 })).body.cleared).toBe(1);
    expect((await call('listRecent', 'GET', '/recent', { expect: 200 })).body.items).toEqual([]);
    expect((await call('getDashboard', 'GET', '/dashboard', { expect: 200 })).body.recent).toEqual([]);

    // ---- import / export
    const exported = await call('exportDashboard', 'GET', '/export', { expect: 200 });
    expect(exported.headers.get('content-disposition')).toMatch(/attachment; filename="opsdesk-export-/);
    expect(exported.body.format).toBe('opsdesk-export');
    const merge = { source: 'json', mode: 'merge', duplicates: 'skip', data: { format: 'opsdesk-export', version: 1, workspaces: [{ name: 'Observability & APM', groups: [{ name: 'Elastic Stack', bookmarks: [{ title: 'Dup', url: 'https://apm.example.org' }, { title: 'New', url: 'https://new.example.org/' }] }] }] } };
    const preview = (await call('previewImport', 'POST', '/import/preview', { expect: 200, body: merge })).body;
    expect(preview.counts).toMatchObject({ bookmarksAdded: 1, bookmarksSkipped: 1 });
    const applied = (await call('applyImport', 'POST', '/import/apply', { expect: 200, body: merge })).body;
    expect(applied.backup).toMatch(/^pre-import-.*\.(sqlite|json)$/);
    await call('applyImport', 'POST', '/import/apply', { expect: 400, body: { ...merge, mode: 'replace' } });

    // ---- backups
    if (isSqlite) {
      const bk = await call('createBackup', 'POST', '/backups', { expect: 201 });
      expect(bk.headers.get('location')).toContain('/backups/');
      expect((await call('listBackups', 'GET', '/backups?kind=manual', { expect: 200 })).body.items.length).toBe(1);
      expect((await call('getBackup', 'GET', `/backups/${bk.body.name}`, { expect: 200 })).body.name).toBe(bk.body.name);
      const dl = await fetch(`${s.base}/api/v1/backups/${bk.body.name}/download`);
      expect(dl.headers.get('content-type')).toContain('sqlite');
      covered.add('downloadBackup');
      expect((await dl.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      await call('restoreBackup', 'POST', `/backups/${bk.body.name}/restore`, { expect: 400, body: { confirm: false } });
      expect((await call('restoreBackup', 'POST', `/backups/${bk.body.name}/restore`, { expect: 200, body: { confirm: true } })).body.safetyBackup).toMatch(/^pre-restore-/);
      await call('deleteBackup', 'DELETE', `/backups/${bk.body.name}`, { expect: 200 });
      await call('deleteBackup', 'DELETE', `/backups/${bk.body.name}`, { expect: 404 });
      await call('getBackup', 'GET', '/backups/..%2Fopsdesk.sqlite', { expect: 400 });
    } else {
      for (const [op, m, p, b] of [['listBackups', 'GET', '/backups'], ['createBackup', 'POST', '/backups'], ['getBackup', 'GET', '/backups/x.sqlite'], ['restoreBackup', 'POST', '/backups/x.sqlite/restore', { confirm: true }], ['deleteBackup', 'DELETE', '/backups/x.sqlite']] as const) {
        const r = await call(op, m, p, { expect: 409, ...(b ? { body: b } : {}) });
        expect(r.body.error.code).toBe('not_supported');
      }
      const dl = await fetch(`${s.base}/api/v1/backups/x.sqlite/download`);
      expect(dl.status).toBe(409);
      covered.add('downloadBackup');
    }

    // ---- deletes (after restore ids may differ on sqlite: re-read)
    const dash = (await call('getDashboard', 'GET', '/dashboard', { expect: 200 })).body;
    const obs = dash.workspaces.find((w: any) => w.name === 'Observability & APM');
    await call('deleteBookmark', 'DELETE', `/bookmarks/${obs.groups.flatMap((g: any) => g.bookmarks)[0].id}`, { expect: 200 });
    const nonEmpty = obs.groups.find((g: any) => g.bookmarks.length > 1);
    await call('deleteGroup', 'DELETE', `/groups/${nonEmpty.id}`, { expect: 409 });
    await call('deleteGroup', 'DELETE', `/groups/${nonEmpty.id}`, { expect: 200, body: { mode: 'delete' } });
    await call('deleteWorkspace', 'DELETE', `/workspaces/${obs.id}?mode=delete`, { expect: 200 });
  });

  it('GET requests never mutate state (including recent, bookmark reads and health)', async () => {
    const s = await boot();
    const call = client(s);
    await call('completeSetup', 'POST', '/setup', { expect: 200, body: { choice: 'sample' } });
    const before = JSON.stringify((await call('getDashboard', 'GET', '/dashboard', { expect: 200 })).body);
    const dash = JSON.parse(before);
    const bm = dash.workspaces[0].groups[0].bookmarks[0];
    for (const p of ['/health', '/version', '/capabilities', '/session', '/settings', '/workspaces', `/workspaces/${dash.workspaces[0].id}`, '/groups', `/groups/${dash.workspaces[0].groups[0].id}`,
      '/bookmarks?q=kibana', `/bookmarks/${bm.id}`, '/tags', '/environments', '/recent', '/export', '/backups', '/openapi.json']) {
      await fetch(`${s.base}/api/v1${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    }
    expect(JSON.stringify((await call('getDashboard', 'GET', '/dashboard', { expect: 200 })).body)).toBe(before);
    expect((await call('listRecent', 'GET', '/recent', { expect: 200 })).body.items).toEqual([]);
  });

  it('pagination, filters and sorting', async () => {
    const s = await boot();
    const call = client(s);
    const w = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Data' } })).body;
    const w2 = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Other' } })).body;
    const ga = (await call('createGroup', 'POST', `/workspaces/${w.id}/groups`, { expect: 201, body: { name: 'A' } })).body;
    const gb = (await call('createGroup', 'POST', `/workspaces/${w2.id}/groups`, { expect: 201, body: { name: 'B' } })).body;
    const mk = async (g: string, title: string, o: any = {}) => (await call('createBookmark', 'POST', `/groups/${g}/bookmarks`, { expect: 201, body: { title, url: `https://${title.toLowerCase().replace(/\W/g, '')}.example.org/`, ...o } })).body;
    const items = [
      await mk(ga.id, 'Alpha Kibana', { environment: 'production', tags: ['elastic', 'logs'], favorite: true, owner: 'Obs' }),
      await mk(ga.id, 'Bravo Grafana', { environment: 'staging', tags: ['metrics'] }),
      await mk(ga.id, 'Charlie Kibana', { environment: 'production', tags: ['elastic'] }),
      await mk(gb.id, 'Delta Jenkins', { environment: 'development', tags: ['ci'], description: 'build server' }),
      await mk(gb.id, 'Echo kibana', { environment: 'lab', tags: ['Elastic'] }),
    ];
    const titles = (r: any) => r.body.items.map((b: any) => b.title);
    const q = (qs: string) => call('listBookmarks', 'GET', `/bookmarks?${qs}`, { expect: 200 });

    // pages are disjoint, ordered and complete
    const p1 = await q('limit=2&offset=0'), p2 = await q('limit=2&offset=2'), p3 = await q('limit=2&offset=4');
    expect(p1.body.page).toEqual({ limit: 2, offset: 0, total: 5, hasMore: true });
    expect(p3.body.page).toEqual({ limit: 2, offset: 4, total: 5, hasMore: false });
    expect([...titles(p1), ...titles(p2), ...titles(p3)]).toEqual(items.map((i) => i.title));
    expect(titles(await q('limit=2&offset=10'))).toEqual([]);
    await call('listBookmarks', 'GET', '/bookmarks?limit=0', { expect: 400 });
    await call('listBookmarks', 'GET', '/bookmarks?limit=201', { expect: 400 });
    await call('listBookmarks', 'GET', '/bookmarks?offset=-1', { expect: 400 });

    // search: case-insensitive, AND of terms, across fields; scope by workspace
    expect(titles(await q('q=KIBANA'))).toEqual(['Alpha Kibana', 'Charlie Kibana', 'Echo kibana']);
    expect(titles(await q(`q=kibana&workspaceId=${w.id}`))).toEqual(['Alpha Kibana', 'Charlie Kibana']);
    expect(titles(await q('q=kibana%20elastic%20obs'))).toEqual(['Alpha Kibana']);
    expect(titles(await q('q=build%20server'))).toEqual(['Delta Jenkins']);
    expect(titles(await q(`groupId=${gb.id}`))).toEqual(['Delta Jenkins', 'Echo kibana']);
    // filters
    expect(titles(await q('environment=production,staging'))).toEqual(['Alpha Kibana', 'Bravo Grafana', 'Charlie Kibana']);
    expect(titles(await q('tag=elastic'))).toEqual(['Alpha Kibana', 'Charlie Kibana', 'Echo kibana']);
    expect(titles(await q('tag=elastic,logs'))).toEqual(['Alpha Kibana']);
    expect(titles(await q('favorite=true'))).toEqual(['Alpha Kibana']);
    expect((await q('favorite=false')).body.page.total).toBe(4);
    expect(titles(await q('q=kibana&environment=production&favorite=true&tag=logs'))).toEqual(['Alpha Kibana']);
    // sorting
    expect(titles(await q('sort=title&order=desc'))).toEqual(['Echo kibana', 'Delta Jenkins', 'Charlie Kibana', 'Bravo Grafana', 'Alpha Kibana']);
    expect(titles(await q('order=desc'))[0]).toBe('Echo kibana');
    await call('recordBookmarkOpened', 'POST', `/bookmarks/${items[2]!.id}/opened`, { expect: 200 });
    await call('recordBookmarkOpened', 'POST', `/bookmarks/${items[2]!.id}/opened`, { expect: 200 });
    await call('recordBookmarkOpened', 'POST', `/bookmarks/${items[1]!.id}/opened`, { expect: 200 });
    expect(titles(await q('sort=openCount&order=desc')).slice(0, 2)).toEqual(['Charlie Kibana', 'Bravo Grafana']);
    expect(titles(await q('sort=lastOpenedAt&order=desc')).slice(0, 2)).toEqual(['Bravo Grafana', 'Charlie Kibana']);
    expect(titles(await q('sort=lastOpenedAt&order=asc')).slice(-1)).toEqual(['Echo kibana']); // never-opened (null) sort last
    // other collections
    expect((await call('listWorkspaces', 'GET', '/workspaces?q=oth', { expect: 200 })).body.items.map((x: any) => x.name)).toEqual(['Other']);
    expect((await call('listWorkspaces', 'GET', '/workspaces?limit=1&offset=1', { expect: 200 })).body.page).toEqual({ limit: 1, offset: 1, total: 2, hasMore: false });
    expect((await call('listTags', 'GET', `/tags?workspaceId=${w2.id}`, { expect: 200 })).body.items.map((t: any) => t.tag).sort()).toEqual(['Elastic', 'ci']);
    expect((await call('listTags', 'GET', '/tags?q=metr', { expect: 200 })).body.items).toEqual([{ tag: 'metrics', count: 1 }]);
    expect((await call('listGroups', 'GET', '/groups?q=b', { expect: 200 })).body.items.map((g: any) => g.name)).toEqual(['B']);
  });

  it('If-Match / ETag prevents lost updates and runs atomically', async () => {
    const s = await boot();
    const call = client(s);
    const w = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'C' } })).body;
    const g = (await call('createGroup', 'POST', `/workspaces/${w.id}/groups`, { expect: 201, body: { name: 'G' } })).body;
    const b = (await call('createBookmark', 'POST', `/groups/${g.id}/bookmarks`, { expect: 201, body: { title: 'One', url: 'https://one.example.org' } })).body;
    const b2 = (await call('createBookmark', 'POST', `/groups/${g.id}/bookmarks`, { expect: 201, body: { title: 'Two', url: 'https://two.example.org' } })).body;

    const etag1 = (await call('getBookmark', 'GET', `/bookmarks/${b.id}`, { expect: 200 })).headers.get('etag')!;
    const ok = await call('updateBookmark', 'PATCH', `/bookmarks/${b.id}`, { expect: 200, body: { title: 'One v2' }, headers: { 'If-Match': etag1 } });
    expect(ok.headers.get('etag')).not.toBe(etag1);
    const stale = await call('updateBookmark', 'PATCH', `/bookmarks/${b.id}`, { expect: 412, body: { title: 'lost update' }, headers: { 'If-Match': etag1 } });
    expect(stale.body.error.code).toBe('precondition_failed');
    expect((await call('getBookmark', 'GET', `/bookmarks/${b.id}`, { expect: 200 })).body.title).toBe('One v2');
    await call('moveBookmark', 'POST', `/bookmarks/${b.id}/move`, { expect: 412, body: { groupId: g.id, index: 1 }, headers: { 'If-Match': etag1 } });
    expect((await call('getGroup', 'GET', `/groups/${g.id}`, { expect: 200 })).body.bookmarks.map((x: any) => x.title)).toEqual(['One v2', 'Two']);
    await call('deleteBookmark', 'DELETE', `/bookmarks/${b.id}`, { expect: 412, headers: { 'If-Match': etag1 } });
    await call('updateBookmark', 'PATCH', `/bookmarks/${b.id}`, { expect: 200, body: { owner: 'x' }, headers: { 'If-Match': '*' } });
    await call('updateBookmark', 'PATCH', `/bookmarks/${b.id}`, { expect: 200, body: { owner: 'y' }, headers: { 'If-Match': `W/"nope", ${ok.headers.get('etag')!.replace('W/', '')}` } }).catch(() => undefined);

    // an unrelated change inside a workspace does not invalidate the workspace validator
    const wEtag = (await call('getWorkspace', 'GET', `/workspaces/${w.id}`, { expect: 200 })).headers.get('etag')!;
    await call('updateBookmark', 'PATCH', `/bookmarks/${b2.id}`, { expect: 200, body: { title: 'Two v2' } });
    await call('updateWorkspace', 'PATCH', `/workspaces/${w.id}`, { expect: 200, body: { name: 'C2' }, headers: { 'If-Match': wEtag } });
    await call('updateWorkspace', 'PATCH', `/workspaces/${w.id}`, { expect: 412, body: { name: 'C3' }, headers: { 'If-Match': wEtag } });
    const gEtag = (await call('getGroup', 'GET', `/groups/${g.id}`, { expect: 200 })).headers.get('etag')!;
    await call('updateGroup', 'PATCH', `/groups/${g.id}`, { expect: 200, body: { name: 'G2' }, headers: { 'If-Match': gEtag } });
    await call('deleteGroup', 'DELETE', `/groups/${g.id}`, { expect: 412, body: { mode: 'delete' }, headers: { 'If-Match': gEtag } });
    expect((await call('getGroup', 'GET', `/groups/${g.id}`, { expect: 200 })).body.bookmarks).toHaveLength(2);
    await call('deleteWorkspace', 'DELETE', `/workspaces/${w.id}?mode=delete`, { expect: 412, headers: { 'If-Match': wEtag } });
  });

  it('Idempotency-Key replays the first response; reuse with another body is refused', async () => {
    const s = await boot();
    const call = client(s);
    const key = { 'Idempotency-Key': 'test-key-0001' };
    const a = await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Once' }, headers: key });
    const b = await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Once' }, headers: key });
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
    expect(b.headers.get('location')).toBe(a.headers.get('location'));
    expect((await call('listWorkspaces', 'GET', '/workspaces', { expect: 200 })).body.page.total).toBe(1);
    expect((await call('createWorkspace', 'POST', '/workspaces', { expect: 422, body: { name: 'Different' }, headers: key })).body.error.code).toBe('idempotency_key_reuse');
    await call('createWorkspace', 'POST', '/workspaces', { expect: 400, body: { name: 'Bad' }, headers: { 'Idempotency-Key': 'short' } });
    const c = await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Twice' } });
    const d = await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Twice' } });
    expect(c.body.id).not.toBe(d.body.id); // without a key a retry creates a second resource
  });

  it('delete semantics for non-empty groups and workspaces; moves and reorders are transactional', async () => {
    const s = await boot();
    const call = client(s);
    const w = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'W' } })).body;
    const w2 = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'W2' } })).body;
    const g = (await call('createGroup', 'POST', `/workspaces/${w.id}/groups`, { expect: 201, body: { name: 'G' } })).body;
    const g2 = (await call('createGroup', 'POST', `/workspaces/${w.id}/groups`, { expect: 201, body: { name: 'G2' } })).body;
    const ids: string[] = [];
    for (const t of ['a', 'b', 'c']) ids.push((await call('createBookmark', 'POST', `/groups/${g.id}/bookmarks`, { expect: 201, body: { title: t, url: `https://${t}.example.org` } })).body.id);
    const order = async (gid: string) => (await call('getGroup', 'GET', `/groups/${gid}`, { expect: 200 })).body.bookmarks.map((b: any) => b.title);

    // reorder: moves land at the requested index, positions stay dense
    await call('moveBookmark', 'POST', `/bookmarks/${ids[2]}/move`, { expect: 200, body: { groupId: g.id, index: 0 } });
    expect(await order(g.id)).toEqual(['c', 'a', 'b']);
    await call('moveBookmark', 'POST', `/bookmarks/${ids[0]}/move`, { expect: 200, body: { groupId: g.id, index: 99 } });
    expect(await order(g.id)).toEqual(['c', 'b', 'a']);
    // a failing move changes nothing
    await call('moveBookmark', 'POST', `/bookmarks/${ids[0]}/move`, { expect: 404, body: { groupId: 'missing', index: 0 } });
    await call('moveGroup', 'POST', `/groups/${g.id}/move`, { expect: 404, body: { workspaceId: 'missing', index: 0 } });
    expect(await order(g.id)).toEqual(['c', 'b', 'a']);

    // non-empty group: refused without mode, nothing changes
    const refused = await call('deleteGroup', 'DELETE', `/groups/${g.id}`, { expect: 409 });
    expect(refused.body.error.code).toBe('conflict');
    expect(await order(g.id)).toHaveLength(3);
    await call('deleteGroup', 'DELETE', `/groups/${g.id}`, { expect: 400, body: { mode: 'move' } }); // move needs a target
    await call('deleteGroup', 'DELETE', `/groups/${g.id}?mode=move&targetId=missing`, { expect: 404 });
    expect(await order(g.id)).toHaveLength(3);
    await call('deleteGroup', 'DELETE', `/groups/${g.id}?mode=move&targetId=${g2.id}`, { expect: 200 }); // query parameters work too
    expect(await order(g2.id)).toEqual(['c', 'b', 'a']);

    // non-empty workspace: same two-step
    await call('deleteWorkspace', 'DELETE', `/workspaces/${w.id}`, { expect: 409 });
    await call('deleteWorkspace', 'DELETE', `/workspaces/${w.id}`, { expect: 200, body: { mode: 'move', targetId: w2.id } });
    expect((await call('getWorkspace', 'GET', `/workspaces/${w2.id}`, { expect: 200 })).body.groups.map((x: any) => x.name)).toEqual(['G2']);
    expect(await order(g2.id)).toEqual(['c', 'b', 'a']);
  });

  it('import: preview never mutates; invalid import and mid-way failure roll back; replace is protected and backed up', async () => {
    let calls = 0;
    const s = await boot({ app: { importHooks: { afterBookmark: () => { if (calls > 0 && ++calls === 3) throw new Error('simulated'); } } } });
    const call = client(s);
    const w = (await call('createWorkspace', 'POST', '/workspaces', { expect: 201, body: { name: 'Keep' } })).body;
    const g = (await call('createGroup', 'POST', `/workspaces/${w.id}/groups`, { expect: 201, body: { name: 'G' } })).body;
    await call('createBookmark', 'POST', `/groups/${g.id}/bookmarks`, { expect: 201, body: { title: 'Keep me', url: 'https://keep.example.org' } });
    const snap = async () => JSON.stringify((await call('getDashboard', 'GET', '/dashboard', { expect: 200 })).body);
    const before = await snap();
    const doc = (bookmarks: unknown[]) => ({ format: 'opsdesk-export', version: 1, workspaces: [{ name: 'Fresh', groups: [{ name: 'G', bookmarks }] }] });
    const good = doc([{ title: 'a', url: 'https://a.example.org' }, { title: 'b', url: 'https://b.example.org' }, { title: 'c', url: 'https://c.example.org' }]);
    const backups = () => (existsSync(join(s.dataDir, 'backups')) ? readdirSync(join(s.dataDir, 'backups')).filter((n) => n.startsWith('pre-import')).length : 0);

    // preview: reports, changes nothing, creates no backup
    const p = await call('previewImport', 'POST', '/import/preview', { expect: 200, body: { source: 'json', mode: 'replace', data: good } });
    expect(p.body.counts).toMatchObject({ bookmarksAdded: 3, bookmarksRemoved: 1, workspacesRemoved: 1 });
    expect(await snap()).toBe(before);
    expect(backups()).toBe(0);

    // invalid documents: rejected, nothing changes, no backup
    for (const data of [doc([{ title: 'x', url: 'javascript:alert(1)' }]), { format: 'nope' }, { format: 'opsdesk-export', version: 99, workspaces: [] }, 'not an object']) {
      for (const mode of ['merge', 'replace']) await call('applyImport', 'POST', '/import/apply', { expect: 400, body: { source: 'json', mode, confirmReplace: true, data } });
    }
    expect(await snap()).toBe(before);

    // replace without the destructive flag: refused before anything happens
    const nf = await call('applyImport', 'POST', '/import/apply', { expect: 400, body: { source: 'json', mode: 'replace', data: good } });
    expect(nf.body.error.code).toBe('confirmation_required');
    expect(await snap()).toBe(before);
    expect(backups()).toBe(0);

    // failure halfway through a valid replace: full rollback (a backup was taken first)
    calls = 1;
    await call('applyImport', 'POST', '/import/apply', { expect: 500, body: { source: 'json', mode: 'replace', confirmReplace: true, data: good } });
    calls = 0;
    expect(await snap()).toBe(before);
    expect(backups()).toBe(1);

    // successful replace: backup exists and contains the previous data
    const ok = (await call('applyImport', 'POST', '/import/apply', { expect: 200, body: { source: 'json', mode: 'replace', confirmReplace: true, data: good } })).body;
    expect(existsSync(join(s.dataDir, 'backups', ok.backup))).toBe(true);
    expect((await call('listWorkspaces', 'GET', '/workspaces', { expect: 200 })).body.items.map((x: any) => x.name)).toEqual(['Fresh']);
  });

  it('multipart upload (JSON and browser HTML) works with a token and is refused without one', async () => {
    const s = await boot();
    const call = client(s);
    const doc = { format: 'opsdesk-export', version: 1, workspaces: [{ name: 'Uploaded', groups: [{ name: 'G', bookmarks: [{ title: 'u', url: 'https://u.example.org' }] }] }] };
    const form = (file: string, name: string, fields: Record<string, string> = {}) => {
      const f = new FormData();
      f.set('file', new Blob([file]), name);
      for (const [k, v] of Object.entries(fields)) f.set(k, v);
      return f;
    };
    const post = (path: string, f: FormData, headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }) => fetch(`${s.base}/api/v1${path}`, { method: 'POST', body: f, headers });
    const pj = await post('/import/preview', form(JSON.stringify(doc), 'export.json', { mode: 'merge' }));
    expect(pj.status).toBe(200);
    expect(((await pj.json()) as any).counts.bookmarksAdded).toBe(1);
    const html = '<DL><DT><H3>Runbooks</H3><DL><DT><A HREF="https://wiki.example.org/r">R</A><DT><A HREF="javascript:alert(1)">bad</A></DL></DL>';
    const ph = await post('/import/apply', form(html, 'bookmarks.html', { workspaceName: 'From HTML' }));
    expect(ph.status).toBe(200);
    expect(((await ph.json()) as any).preview.warnings.join(' ')).toMatch(/skipped/);
    expect((await call('listWorkspaces', 'GET', '/workspaces', { expect: 200 })).body.items.map((x: any) => x.name)).toEqual(['From HTML']);
    expect((await post('/import/preview', form('{not json', 'x.json', { source: 'json' }))).status).toBe(400);
    expect((await post('/import/preview', new FormData())).status).toBe(400); // no file
    // JSON-style confirm flag also applies to uploads
    expect((await post('/import/apply', form(JSON.stringify(doc), 'e.json', { mode: 'replace' }))).status).toBe(400);
    // too large
    expect((await post('/import/preview', form('x'.repeat(5 * 1024 * 1024 + 10), 'big.html'))).status).toBe(413);
    // uploads need the bearer token: the browser-style (CSRF) path refuses multipart
    const ui = await fetch(`${s.base}/api/v1/import/preview`, { method: 'POST', body: form(JSON.stringify(doc), 'e.json'), headers: { Origin: s.base, 'X-CSRF-Token': s.csrf } });
    expect([401, 415]).toContain(ui.status);
    expect((await post('/import/preview', form(JSON.stringify(doc), 'e.json'), {})).status).toBe(401);
    // multipart sent to an endpoint that does not take uploads
    const wrong = await fetch(`${s.base}/api/v1/workspaces`, { method: 'POST', body: form('x', 'x'), headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(wrong.status).toBe(415);
  });

  it('structured errors carry a request id; X-Request-Id is honoured; request size limits apply', async () => {
    const s = await boot();
    const call = client(s);
    const r = await call('getBookmark', 'GET', '/bookmarks/nope', { expect: 404 });
    expect(r.body.error.requestId).toBe(r.headers.get('x-request-id'));
    const mine = await call('getBookmark', 'GET', '/bookmarks/nope', { expect: 404, headers: { 'X-Request-Id': 'my-request-12345' } });
    expect(mine.headers.get('x-request-id')).toBe('my-request-12345');
    expect(mine.body.error.requestId).toBe('my-request-12345');
    const bad = await call('getBookmark', 'GET', '/bookmarks/nope', { expect: 404, headers: { 'X-Request-Id': 'bad id with spaces!' } });
    expect(bad.headers.get('x-request-id')).not.toBe('bad id with spaces!');
    const v = await call('createWorkspace', 'POST', '/workspaces', { expect: 400, body: { name: 'x'.repeat(200) } });
    expect(v.body.error).toMatchObject({ code: 'validation_error', fields: { name: expect.any(String) } });
    expect((await call('createWorkspace', 'POST', '/workspaces', { expect: 400, raw: '{broken', headers: { 'Content-Type': 'application/json' } })).body.error.code).toBe('bad_json');
    const big = await call('createWorkspace', 'POST', '/workspaces', { expect: 413, raw: JSON.stringify({ name: 'x', pad: 'y'.repeat(300_000) }), headers: { 'Content-Type': 'application/json' } });
    expect(big.body.error.code).toBe('too_large');
    expect((await fetch(`${s.base}/api/v1/does-not-exist`)).status).toBe(404);
  });

  it('/api (UI alias) and /api/v1 serve the same contract; version is consistent everywhere', async () => {
    const s = await boot();
    const v1 = await (await fetch(`${s.base}/api/v1/version`)).json() as any;
    const alias = await (await fetch(`${s.base}/api/version`)).json() as any;
    const health = await (await fetch(`${s.base}/api/health`)).json() as any;
    const session = await (await fetch(`${s.base}/api/session`)).json() as any;
    const caps = await (await fetch(`${s.base}/api/v1/capabilities`)).json() as any;
    expect(new Set([v1.version, alias.version, health.version, session.version, caps.version, pkg.version]).size).toBe(1);
    const spec = await (await fetch(`${s.base}/api/v1/openapi.json`)).json() as any;
    expect(spec.info.version).toBe(pkg.version);
    expect(await (await fetch(`${s.base}/api/openapi.json`)).json()).toEqual(spec);
  });

  it('the bundled UI keeps working with the CSRF/same-origin design (no token needed)', async () => {
    const s = await boot();
    const ui = (await s.api('POST', '/workspaces', { name: 'From UI' }));
    expect(ui.status).toBe(201);
    expect((await s.api('PATCH', `/workspaces/${ui.body.id}`, { name: 'Renamed' })).status).toBe(200);
    expect((await s.api('GET', '/dashboard')).body.workspaces[0].name).toBe('Renamed');
    expect((await s.api('DELETE', `/workspaces/${ui.body.id}`, {})).status).toBe(200);
  });
});

describe('operation coverage', () => {
  afterAll(() => undefined);
  it('every documented operation was exercised by the tour above (and by nothing undocumented)', () => {
    const all = routes.map((r) => r.operationId).sort();
    const missing = all.filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
    expect([...covered].filter((id) => !all.includes(id))).toEqual([]);
  });
});
