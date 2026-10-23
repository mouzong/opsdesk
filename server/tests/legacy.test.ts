import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createContext } from '../context.js';
import { getDashboard } from '../repo.js';
import { cleanup, startServer, tempDir, testConfig } from './helpers.js';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanup(dirs.pop()!); });

/** A database exactly as OpsDesk 1.0.0 wrote it: schema v1 tracked with PRAGMA user_version, no schema_migrations. */
function writeLegacyDb(file: string) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, position INTEGER NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE bookmark_groups (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, is_sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_groups_workspace ON bookmark_groups(workspace_id, position);
    CREATE TABLE bookmarks (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES bookmark_groups(id) ON DELETE CASCADE, title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', environment TEXT NOT NULL DEFAULT 'other' CHECK (environment IN ('production','preproduction','staging','development','lab','other')), owner TEXT NOT NULL DEFAULT '', icon TEXT, tags TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', is_sample INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT, open_count INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX idx_bookmarks_group ON bookmarks(group_id, position);
    CREATE INDEX idx_bookmarks_opened ON bookmarks(last_opened_at);
    PRAGMA user_version = 1;
    INSERT INTO meta VALUES ('title', 'Mon bureau'), ('setup', 'done');
    INSERT INTO workspaces VALUES ('w1','Observability','activity',0,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'), ('w2','Infra','server',1,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO bookmark_groups VALUES ('g1','w1','Elastic',0,0,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z'), ('g2','w1','Metrics',1,1,0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    INSERT INTO bookmarks (id, group_id, title, url, environment, tags, favorite, note, position, created_at, updated_at, last_opened_at, open_count)
      VALUES ('b1','g1','Kibana','https://kibana.example.org:5601/','production','["elastic","logs"]',1,'note ✓',1,'2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z','2026-02-01T00:00:00.000Z',3),
             ('b2','g1','APM','https://apm.example.org/','staging','[]',0,'',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL,0),
             ('b3','g2','Grafana','https://grafana.example.org/','production','["metrics"]',0,'',0,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL,0);
  `);
  db.close();
}

describe('upgrade from an existing SQLite database (OpsDesk 1.0.0 schema)', () => {
  it('keeps all data, order and preferences, adopts the version history and keeps working', async () => {
    const dir = tempDir(); dirs.push(dir);
    writeLegacyDb(join(dir, 'opsdesk.sqlite'));
    const ctx = await createContext(testConfig(dir));
    const d = await getDashboard(ctx.db);
    expect(d.title).toBe('Mon bureau');
    expect(d.setup).toBe('done');
    expect(d.workspaces.map((w) => w.name)).toEqual(['Observability', 'Infra']);
    expect(d.workspaces[0]!.groups.map((g) => [g.name, g.collapsed, g.bookmarks.map((b) => b.title)])).toEqual([['Elastic', false, ['APM', 'Kibana']], ['Metrics', true, ['Grafana']]]);
    const kibana = d.workspaces[0]!.groups[0]!.bookmarks[1]!;
    expect(kibana).toMatchObject({ favorite: true, tags: ['elastic', 'logs'], note: 'note ✓', environment: 'production', lastOpenedAt: '2026-02-01T00:00:00.000Z' });
    expect(d.recent).toEqual(['b1']);
    const versions = (await ctx.db.query('SELECT version FROM schema_migrations ORDER BY version')).map((r) => Number(r.version));
    expect(versions).toEqual([1, 2]);
    await ctx.closeDb();
  });

  it('works through the HTTP API after the upgrade (create, restart, persisted)', async () => {
    const dir = tempDir(); dirs.push(dir);
    writeLegacyDb(join(dir, 'opsdesk.sqlite'));
    const s = await startServer({ dataDir: dir });
    expect((await s.api('POST', '/groups/g1/bookmarks', { title: 'New', url: 'https://new.example.org' })).status).toBe(201);
    const health = await (await fetch(`${s.base}/api/health`)).json() as any;
    expect(health.status).toBe('green');
    await s.close();
    const s2 = await startServer({ dataDir: dir });
    const dash = (await s2.api('GET', '/dashboard')).body;
    expect(dash.workspaces[0].groups[0].bookmarks.map((b: any) => b.title)).toEqual(['APM', 'Kibana', 'New']);
    await s2.close();
  });
});
