import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../context.js';
import * as repo from '../repo.js';
import { completeSetup } from '../sample.js';
import { cleanup, ENGINES, newContext } from './helpers.js';

for (const engine of ENGINES) describe(`repository [${engine.name}]`, () => {
  let dir: string;
  let ctx: AppContext;
  beforeEach(async () => {
    ({ ctx, dataDir: dir } = await newContext(engine));
  });
  afterEach(async () => {
    await ctx.closeDb();
    cleanup(dir);
  });

  const titles = async (groupId: string) =>
    (await repo.getDashboard(ctx.db)).workspaces.flatMap((w) => w.groups).find((g) => g.id === groupId)!.bookmarks.map((b) => b.title);
  async function seed() {
    const w = await repo.createWorkspace(ctx.db, { name: 'Ops' });
    const g1 = await repo.createGroup(ctx.db, w.id, { name: 'A' });
    const g2 = await repo.createGroup(ctx.db, w.id, { name: 'B' });
    const mk = (g: string, t: string) => repo.createBookmark(ctx.db, g, { title: t, url: `https://${t.toLowerCase()}.example.org/` });
    return { w, g1, g2, mk };
  }

  describe('bookmarks', () => {
    it('creates, updates (with timestamps) and deletes', async () => {
      const { g1, mk } = await seed();
      const b = await mk(g1.id, 'One');
      expect(b.createdAt).toBe(b.updatedAt);
      await new Promise((r) => setTimeout(r, 5));
      const u = await repo.updateBookmark(ctx.db, b.id, { title: 'Uno', tags: ['x', 'y'], favorite: true, environment: 'production' });
      expect(u).toMatchObject({ title: 'Uno', favorite: true, environment: 'production', tags: ['x', 'y'], url: b.url });
      expect(u.updatedAt > b.updatedAt).toBe(true);
      expect(u.createdAt).toBe(b.createdAt);
      await repo.deleteBookmark(ctx.db, b.id);
      expect(await titles(g1.id)).toEqual([]);
    });

    it('round-trips every field type (booleans, JSON tags, unicode, long text, nulls)', async () => {
      const { g1 } = await seed();
      const note = 'ligne 1\nligne 2 — « accents », 日本語, emoji 🚀\t' + 'x'.repeat(3000);
      const b = await repo.createBookmark(ctx.db, g1.id, {
        title: 'Élastique 🚀', url: 'https://kibana.example.org:5601/app?x=1#frag', description: 'd', environment: 'preproduction',
        owner: 'Équipe N2', icon: 'search', tags: ['a b', 'ç', '日本'], favorite: true, note,
      });
      const back = await repo.getBookmark(ctx.db, b.id);
      expect(back).toMatchObject({ title: 'Élastique 🚀', owner: 'Équipe N2', icon: 'search', tags: ['a b', 'ç', '日本'], favorite: true, note, lastOpenedAt: null });
      const noIcon = await repo.createBookmark(ctx.db, g1.id, { title: 'n', url: 'https://n.example.org' });
      expect(noIcon.icon).toBeNull();
      expect(noIcon.favorite).toBe(false);
    });

    it('rejects values the schema forbids (environment CHECK constraint)', async () => {
      const { g1 } = await seed();
      await expect(ctx.db.run(
        "INSERT INTO bookmarks (id, group_id, title, url, description, environment, owner, tags, note, position, created_at, updated_at) VALUES ('x', ?, 't', 'https://a.example.org', '', 'nonsense', '', '[]', '', 0, 'a', 'b')",
        [g1.id],
      )).rejects.toThrow();
    });

    it('enforces foreign keys (no bookmark without a group) and cascades deletes', async () => {
      const { w, g1, mk } = await seed();
      await mk(g1.id, 'A1');
      await expect(repo.createBookmark(ctx.db, 'missing-group', { title: 'x', url: 'https://x.example.org' })).rejects.toThrow();
      await expect(ctx.db.run(
        "INSERT INTO bookmarks (id, group_id, title, url, description, environment, owner, tags, note, position, created_at, updated_at) VALUES ('y', 'ghost', 't', 'https://a.example.org', '', 'other', '', '[]', '', 0, 'a', 'b')",
      )).rejects.toThrow();
      await ctx.db.run('DELETE FROM workspaces WHERE id = ?', [w.id]);
      expect(await repo.countAll(ctx.db)).toEqual({ workspaces: 0, groups: 0, bookmarks: 0 });
    });

    it('reorders within a group and persists dense positions', async () => {
      const { g1, mk } = await seed();
      const [a, , c] = [await mk(g1.id, 'A1'), await mk(g1.id, 'B1'), await mk(g1.id, 'C1')];
      await repo.moveBookmark(ctx.db, c.id, { groupId: g1.id, index: 0 });
      expect(await titles(g1.id)).toEqual(['C1', 'A1', 'B1']);
      await repo.moveBookmark(ctx.db, a.id, { groupId: g1.id, index: 99 });
      expect(await titles(g1.id)).toEqual(['C1', 'B1', 'A1']);
      const rows = await ctx.db.query('SELECT position FROM bookmarks ORDER BY position');
      expect(rows.map((r) => Number(r.position))).toEqual([0, 1, 2]);
    });

    it('moves between groups and across workspaces', async () => {
      const { g1, g2, mk } = await seed();
      const w2 = await repo.createWorkspace(ctx.db, { name: 'Other' });
      const g3 = await repo.createGroup(ctx.db, w2.id, { name: 'C' });
      const a = await mk(g1.id, 'A1');
      await mk(g2.id, 'B1');
      await repo.moveBookmark(ctx.db, a.id, { groupId: g2.id, index: 0 });
      expect(await titles(g2.id)).toEqual(['A1', 'B1']);
      expect(await titles(g1.id)).toEqual([]);
      await repo.moveBookmark(ctx.db, a.id, { groupId: g3.id, index: 0 });
      expect(await titles(g3.id)).toEqual(['A1']);
    });

    it('duplicates right after the original, without the pin', async () => {
      const { g1, mk } = await seed();
      const a = await mk(g1.id, 'A1');
      await mk(g1.id, 'B1');
      await repo.updateBookmark(ctx.db, a.id, { favorite: true });
      const copy = await repo.duplicateBookmark(ctx.db, a.id);
      expect(copy.title).toBe('A1 (copy)');
      expect(copy.favorite).toBe(false);
      expect(await titles(g1.id)).toEqual(['A1', 'A1 (copy)', 'B1']);
    });

    it('records opens for the recent list', async () => {
      const { g1, mk } = await seed();
      const a = await mk(g1.id, 'A1');
      const b = await mk(g1.id, 'B1');
      await repo.markOpened(ctx.db, a.id);
      await new Promise((r) => setTimeout(r, 5));
      await repo.markOpened(ctx.db, b.id);
      expect((await repo.getDashboard(ctx.db)).recent).toEqual([b.id, a.id]);
    });
  });

  describe('groups and workspaces', () => {
    it('requires a choice for non-empty groups, then moves or deletes atomically', async () => {
      const { g1, g2, mk } = await seed();
      await mk(g1.id, 'A1');
      await mk(g1.id, 'A2');
      await mk(g2.id, 'B1');
      await expect(repo.deleteGroup(ctx.db, g1.id, {})).rejects.toThrowError(/not empty/);
      await repo.deleteGroup(ctx.db, g1.id, { mode: 'move', targetId: g2.id });
      expect(await titles(g2.id)).toEqual(['B1', 'A1', 'A2']);
      await repo.deleteGroup(ctx.db, g2.id, { mode: 'delete' });
      expect(await repo.countAll(ctx.db)).toEqual({ workspaces: 1, groups: 0, bookmarks: 0 });
    });

    it('a failed move-delete leaves everything intact (rollback)', async () => {
      const { g1, mk } = await seed();
      await mk(g1.id, 'A1');
      await expect(repo.deleteGroup(ctx.db, g1.id, { mode: 'move', targetId: 'does-not-exist' })).rejects.toThrow();
      expect(await repo.countAll(ctx.db)).toEqual({ workspaces: 1, groups: 2, bookmarks: 1 });
      const bid = (await repo.getDashboard(ctx.db)).workspaces[0]!.groups[0]!.bookmarks[0]!.id;
      await expect(ctx.db.transaction(async (tx) => { await repo.deleteBookmark(tx, bid); throw new Error('boom'); })).rejects.toThrow('boom');
      expect((await repo.countAll(ctx.db)).bookmarks).toBe(1);
    });

    it('moves groups between workspaces and reorders workspaces', async () => {
      const { w, g1, g2 } = await seed();
      const w2 = await repo.createWorkspace(ctx.db, { name: 'Second' });
      await repo.moveGroup(ctx.db, g1.id, { workspaceId: w2.id, index: 0 });
      const d = await repo.getDashboard(ctx.db);
      expect(d.workspaces.find((x) => x.id === w.id)!.groups.map((g) => g.id)).toEqual([g2.id]);
      expect(d.workspaces.find((x) => x.id === w2.id)!.groups.map((g) => g.id)).toEqual([g1.id]);
      await repo.moveWorkspace(ctx.db, w2.id, 0);
      expect((await repo.getDashboard(ctx.db)).workspaces.map((x) => x.name)).toEqual(['Second', 'Ops']);
    });

    it('deleting a workspace can move its groups elsewhere', async () => {
      const { w, g1, mk } = await seed();
      await mk(g1.id, 'A1');
      const w2 = await repo.createWorkspace(ctx.db, { name: 'Second' });
      await expect(repo.deleteWorkspace(ctx.db, w.id, {})).rejects.toThrowError(/not empty/);
      await repo.deleteWorkspace(ctx.db, w.id, { mode: 'move', targetId: w2.id });
      const d = await repo.getDashboard(ctx.db);
      expect(d.workspaces).toHaveLength(1);
      expect(d.workspaces[0]!.groups.map((g) => g.name)).toEqual(['A', 'B']);
      expect(d.workspaces[0]!.groups[0]!.bookmarks).toHaveLength(1);
    });
  });

  describe('preferences stored in the database', () => {
    it('stores and updates the dashboard title (upsert)', async () => {
      expect(await repo.getTitle(ctx.db)).toBe('OpsDesk');
      await repo.setTitle(ctx.db, 'First');
      await repo.setTitle(ctx.db, 'Second');
      expect(await repo.getTitle(ctx.db)).toBe('Second');
      expect(Number((await ctx.db.query('SELECT COUNT(*) AS n FROM meta WHERE "key" = ?', ['title']))[0]!.n)).toBe(1);
    });
  });

  describe('first-run setup and sample data', () => {
    it('inserts the sample once, removes only untouched samples, never reinserts', async () => {
      await completeSetup(ctx.db, 'sample');
      const d1 = await repo.getDashboard(ctx.db);
      expect(d1.setup).toBe('done');
      expect(d1.workspaces.map((w) => w.name)).toEqual(['Daily Operations', 'Observability', 'Infrastructure', 'Delivery & Automation', 'N2/N3 Resources']);
      const kibana = d1.workspaces.flatMap((w) => w.groups).flatMap((g) => g.bookmarks).find((b) => b.title === 'Kibana')!;
      expect(kibana.isSample).toBe(true);
      expect(kibana.url).toMatch(/\.example\.(org|net|com)/);
      await repo.updateBookmark(ctx.db, kibana.id, { owner: 'Me' });
      const removed = await repo.removeSampleData(ctx.db);
      expect(removed.bookmarks).toBeGreaterThan(10);
      const d2 = await repo.getDashboard(ctx.db);
      expect(d2.workspaces.flatMap((w) => w.groups).flatMap((g) => g.bookmarks).map((b) => b.title)).toEqual(['Kibana']);
      expect(d2.setup).toBe('done');
    });

    it('empty choice creates nothing', async () => {
      await completeSetup(ctx.db, 'empty');
      expect(await repo.countAll(ctx.db)).toEqual({ workspaces: 0, groups: 0, bookmarks: 0 });
    });
  });

  describe('transactions', () => {
    it('a rollback-only transaction leaves nothing behind', async () => {
      await ctx.db.transaction((tx) => repo.createWorkspace(tx, { name: 'Temp' }), { rollback: true });
      expect((await repo.countAll(ctx.db)).workspaces).toBe(0);
    });

    it('concurrent writes are serialised and none is lost', async () => {
      const { g1 } = await seed();
      await Promise.all(Array.from({ length: 12 }, (_, i) => repo.createBookmark(ctx.db, g1.id, { title: `c${i}`, url: `https://c${i}.example.org` })));
      const list = await titles(g1.id);
      expect(list).toHaveLength(12);
      const pos = (await ctx.db.query('SELECT position FROM bookmarks ORDER BY position')).map((r) => Number(r.position));
      expect(pos).toEqual(Array.from({ length: 12 }, (_, i) => i));
    });
  });
});
