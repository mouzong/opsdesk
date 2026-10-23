import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE_ICON, ENVIRONMENTS, type Environment } from '../shared/constants.js';
import type { Bookmark, Dashboard, Group, SetupState, Workspace } from '../shared/types.js';
import type { Executor, Param, Row } from './db/types.js';
import { AppError, conflict, notFound } from './errors.js';

type DB = Executor;
const now = () => new Date().toISOString();
const newId = () => randomUUID();

const all = (db: DB, sql: string, ...params: Param[]): Promise<Row[]> => db.query(sql, params);
const one = async (db: DB, sql: string, ...params: Param[]): Promise<Row | undefined> => (await db.query(sql, params))[0];
const run = (db: DB, sql: string, ...params: Param[]) => db.run(sql, params);

/* ------------------------------------------------------------------ meta */

export async function getMeta(db: DB, key: string): Promise<string | null> {
  const row = await one(db, 'SELECT "value" FROM meta WHERE "key" = ?', key);
  return row ? String(row.value) : null;
}
export async function setMeta(db: DB, key: string, value: string): Promise<void> {
  if (db.dialect === 'mysql') {
    await run(db, 'INSERT INTO meta ("key", "value") VALUES (?, ?) ON DUPLICATE KEY UPDATE "value" = VALUES("value")', key, value);
  } else {
    await run(db, 'INSERT INTO meta ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"', key, value);
  }
}
export const getTitle = async (db: DB) => (await getMeta(db, 'title')) ?? 'OpsDesk';
export const getSetupState = async (db: DB): Promise<SetupState> => ((await getMeta(db, 'setup')) === 'done' ? 'done' : 'pending');

/* --------------------------------------------------------------- mappers */

function parseTags(raw: unknown): string[] {
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function mapBookmark(r: Row): Bookmark {
  return {
    id: String(r.id),
    groupId: String(r.group_id),
    title: String(r.title),
    url: String(r.url),
    description: String(r.description),
    environment: (ENVIRONMENTS as readonly string[]).includes(String(r.environment)) ? (r.environment as Environment) : 'other',
    owner: String(r.owner),
    icon: r.icon == null ? null : String(r.icon),
    tags: parseTags(r.tags),
    favorite: Number(r.favorite) === 1,
    note: String(r.note),
    isSample: Number(r.is_sample) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    lastOpenedAt: r.last_opened_at == null ? null : String(r.last_opened_at),
    openCount: Number(r.open_count ?? 0),
  };
}

/* ------------------------------------------------------------- dashboard */

export async function getDashboard(db: DB): Promise<Dashboard> {
  const bookmarks = (await all(db, 'SELECT * FROM bookmarks ORDER BY position')).map(mapBookmark);
  const byGroup = new Map<string, Bookmark[]>();
  for (const b of bookmarks) {
    const list = byGroup.get(b.groupId);
    if (list) list.push(b);
    else byGroup.set(b.groupId, [b]);
  }
  const groupsByWs = new Map<string, Group[]>();
  for (const r of await all(db, 'SELECT * FROM bookmark_groups ORDER BY position')) {
    const g: Group = {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      name: String(r.name),
      collapsed: Number(r.collapsed) === 1,
      isSample: Number(r.is_sample) === 1,
      bookmarks: byGroup.get(String(r.id)) ?? [],
    };
    const list = groupsByWs.get(g.workspaceId);
    if (list) list.push(g);
    else groupsByWs.set(g.workspaceId, [g]);
  }
  const workspaces: Workspace[] = (await all(db, 'SELECT * FROM workspaces ORDER BY position')).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    icon: String(r.icon),
    isSample: Number(r.is_sample) === 1,
    groups: groupsByWs.get(String(r.id)) ?? [],
  }));
  const recent = (await all(db, 'SELECT id FROM bookmarks WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT 12')).map((r) => String(r.id));
  return { title: await getTitle(db), setup: await getSetupState(db), workspaces, recent };
}

/* ------------------------------------------------------------- ordering */

type Table = 'workspaces' | 'bookmark_groups' | 'bookmarks';
type ParentCol = 'workspace_id' | 'group_id' | null;

async function siblingIds(db: DB, table: Table, parentCol: ParentCol, parentId: string | null): Promise<string[]> {
  const rows = parentCol
    ? await all(db, `SELECT id FROM ${table} WHERE ${parentCol} = ? ORDER BY position, created_at`, parentId)
    : await all(db, `SELECT id FROM ${table} ORDER BY position, created_at`);
  return rows.map((r) => String(r.id));
}

async function writeOrder(db: DB, table: Table, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) await run(db, `UPDATE ${table} SET position = ? WHERE id = ?`, i, ids[i]!);
}

async function nextPosition(db: DB, table: Table, parentCol: ParentCol, parentId: string | null): Promise<number> {
  const row = parentCol
    ? await one(db, `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} WHERE ${parentCol} = ?`, parentId)
    : await one(db, `SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table}`);
  return Number(row?.p ?? 0);
}

async function placeAt(db: DB, table: Table, parentCol: ParentCol, parentId: string | null, id: string, index: number): Promise<void> {
  const ids = (await siblingIds(db, table, parentCol, parentId)).filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
  await writeOrder(db, table, ids);
}

const count = async (db: DB, sql: string, ...params: Param[]) => Number((await one(db, sql, ...params))?.n ?? 0);

/* ------------------------------------------------------------ workspaces */

export interface WorkspaceInsert {
  name: string;
  icon?: string | undefined;
  isSample?: boolean;
  createdAt?: string | undefined;
}

export async function insertWorkspace(db: DB, w: WorkspaceInsert): Promise<string> {
  const id = newId();
  const ts = now();
  await run(
    db,
    'INSERT INTO workspaces (id, name, icon, position, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, w.name, w.icon ?? DEFAULT_WORKSPACE_ICON, await nextPosition(db, 'workspaces', null, null), w.isSample ? 1 : 0, w.createdAt ?? ts, ts,
  );
  return id;
}

async function requireWorkspace(db: DB, id: string): Promise<Row> {
  const row = await one(db, 'SELECT * FROM workspaces WHERE id = ?', id);
  if (!row) throw notFound('Workspace');
  return row;
}

export async function createWorkspace(db: DB, input: { name: string; icon?: string | undefined }): Promise<Workspace> {
  return db.transaction(async (tx) => getWorkspace(tx, await insertWorkspace(tx, input)));
}

export async function getWorkspace(db: DB, id: string): Promise<Workspace> {
  const ws = (await getDashboard(db)).workspaces.find((w) => w.id === id);
  if (!ws) throw notFound('Workspace');
  return ws;
}

export async function updateWorkspace(db: DB, id: string, patch: { name?: string | undefined; icon?: string | undefined }): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const cur = await requireWorkspace(tx, id);
    await run(tx, 'UPDATE workspaces SET name = ?, icon = ?, is_sample = 0, updated_at = ? WHERE id = ?',
      patch.name ?? String(cur.name), patch.icon ?? String(cur.icon), now(), id);
    return getWorkspace(tx, id);
  });
}

export async function moveWorkspace(db: DB, id: string, index: number): Promise<void> {
  await db.transaction(async (tx) => {
    await requireWorkspace(tx, id);
    await placeAt(tx, 'workspaces', null, null, id, index);
  });
}

export async function deleteWorkspace(db: DB, id: string, opts: { mode?: 'delete' | 'move' | undefined; targetId?: string | undefined }): Promise<void> {
  await db.transaction(async (tx) => {
    await requireWorkspace(tx, id);
    const groupCount = await count(tx, 'SELECT COUNT(*) AS n FROM bookmark_groups WHERE workspace_id = ?', id);
    if (groupCount > 0) {
      if (!opts.mode) throw conflict('This workspace is not empty. Choose whether to move its groups or delete them.');
      if (opts.mode === 'move') {
        if (!opts.targetId || opts.targetId === id) throw new AppError(400, 'validation_error', 'Choose another workspace to move the groups to.');
        await requireWorkspace(tx, opts.targetId);
        const moving = await siblingIds(tx, 'bookmark_groups', 'workspace_id', id);
        const base = await nextPosition(tx, 'bookmark_groups', 'workspace_id', opts.targetId);
        for (let i = 0; i < moving.length; i++) {
          await run(tx, 'UPDATE bookmark_groups SET workspace_id = ?, position = ?, is_sample = 0, updated_at = ? WHERE id = ?', opts.targetId, base + i, now(), moving[i]!);
        }
      }
    }
    await run(tx, 'DELETE FROM workspaces WHERE id = ?', id);
    await writeOrder(tx, 'workspaces', await siblingIds(tx, 'workspaces', null, null));
  });
}

/* ---------------------------------------------------------------- groups */

export async function insertGroup(db: DB, workspaceId: string, g: { name: string; collapsed?: boolean; isSample?: boolean }): Promise<string> {
  const id = newId();
  const ts = now();
  await run(
    db,
    'INSERT INTO bookmark_groups (id, workspace_id, name, position, collapsed, is_sample, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, workspaceId, g.name, await nextPosition(db, 'bookmark_groups', 'workspace_id', workspaceId), g.collapsed ? 1 : 0, g.isSample ? 1 : 0, ts, ts,
  );
  return id;
}

async function requireGroup(db: DB, id: string): Promise<Row> {
  const row = await one(db, 'SELECT * FROM bookmark_groups WHERE id = ?', id);
  if (!row) throw notFound('Group');
  return row;
}

export async function getGroup(db: DB, id: string): Promise<Group> {
  const row = await requireGroup(db, id);
  const ws = await getWorkspace(db, String(row.workspace_id));
  return ws.groups.find((g) => g.id === id)!;
}

export async function createGroup(db: DB, workspaceId: string, input: { name: string }): Promise<Group> {
  return db.transaction(async (tx) => {
    await requireWorkspace(tx, workspaceId);
    if ((await count(tx, 'SELECT COUNT(*) AS n FROM bookmark_groups WHERE workspace_id = ?', workspaceId)) >= 100) {
      throw new AppError(400, 'limit_reached', 'A workspace can contain at most 100 groups.');
    }
    return getGroup(tx, await insertGroup(tx, workspaceId, input));
  });
}

export async function updateGroup(db: DB, id: string, patch: { name?: string | undefined; collapsed?: boolean | undefined }): Promise<Group> {
  return db.transaction(async (tx) => {
    const cur = await requireGroup(tx, id);
    const renamed = patch.name !== undefined && patch.name !== String(cur.name);
    await run(tx, 'UPDATE bookmark_groups SET name = ?, collapsed = ?, is_sample = ?, updated_at = ? WHERE id = ?',
      patch.name ?? String(cur.name),
      patch.collapsed === undefined ? Number(cur.collapsed) : patch.collapsed ? 1 : 0,
      renamed ? 0 : Number(cur.is_sample),
      now(), id);
    return getGroup(tx, id);
  });
}

export async function moveGroup(db: DB, id: string, to: { workspaceId?: string | undefined; index: number }): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = await requireGroup(tx, id);
    const targetWs = to.workspaceId ?? String(cur.workspace_id);
    await requireWorkspace(tx, targetWs);
    if (targetWs !== String(cur.workspace_id)) {
      await run(tx, 'UPDATE bookmark_groups SET workspace_id = ?, is_sample = 0, updated_at = ? WHERE id = ?', targetWs, now(), id);
      await writeOrder(tx, 'bookmark_groups', await siblingIds(tx, 'bookmark_groups', 'workspace_id', String(cur.workspace_id)));
    }
    await placeAt(tx, 'bookmark_groups', 'workspace_id', targetWs, id, to.index);
  });
}

export async function deleteGroup(db: DB, id: string, opts: { mode?: 'delete' | 'move' | undefined; targetId?: string | undefined }): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = await requireGroup(tx, id);
    const n = await count(tx, 'SELECT COUNT(*) AS n FROM bookmarks WHERE group_id = ?', id);
    if (n > 0) {
      if (!opts.mode) throw conflict('This group is not empty. Choose whether to move its bookmarks or delete them.');
      if (opts.mode === 'move') {
        if (!opts.targetId || opts.targetId === id) throw new AppError(400, 'validation_error', 'Choose another group to move the bookmarks to.');
        await requireGroup(tx, opts.targetId);
        const moving = await siblingIds(tx, 'bookmarks', 'group_id', id);
        const base = await nextPosition(tx, 'bookmarks', 'group_id', opts.targetId);
        for (let i = 0; i < moving.length; i++) {
          await run(tx, 'UPDATE bookmarks SET group_id = ?, position = ?, is_sample = 0, updated_at = ? WHERE id = ?', opts.targetId, base + i, now(), moving[i]!);
        }
      }
    }
    await run(tx, 'DELETE FROM bookmark_groups WHERE id = ?', id);
    await writeOrder(tx, 'bookmark_groups', await siblingIds(tx, 'bookmark_groups', 'workspace_id', String(cur.workspace_id)));
  });
}

/* ------------------------------------------------------------- bookmarks */

export interface BookmarkData {
  title: string;
  url: string;
  description?: string | undefined;
  environment?: Environment | undefined;
  owner?: string | undefined;
  icon?: string | null | undefined;
  tags?: string[] | undefined;
  favorite?: boolean | undefined;
  note?: string | undefined;
}

export async function insertBookmark(
  db: DB,
  groupId: string,
  b: BookmarkData,
  opts: { isSample?: boolean; createdAt?: string | undefined; updatedAt?: string | undefined; position?: number } = {},
): Promise<string> {
  const id = newId();
  const ts = now();
  await run(
    db,
    `INSERT INTO bookmarks (id, group_id, title, url, description, environment, owner, icon, tags, favorite, note, is_sample, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, groupId, b.title, b.url, b.description ?? '', b.environment ?? 'other', b.owner ?? '', b.icon ?? null,
    JSON.stringify(b.tags ?? []), b.favorite ? 1 : 0, b.note ?? '', opts.isSample ? 1 : 0,
    opts.position ?? (await nextPosition(db, 'bookmarks', 'group_id', groupId)), opts.createdAt ?? ts, opts.updatedAt ?? ts,
  );
  return id;
}

async function requireBookmarkRow(db: DB, id: string): Promise<Row> {
  const row = await one(db, 'SELECT * FROM bookmarks WHERE id = ?', id);
  if (!row) throw notFound('Bookmark');
  return row;
}

export const getBookmark = async (db: DB, id: string): Promise<Bookmark> => mapBookmark(await requireBookmarkRow(db, id));

export async function createBookmark(db: DB, groupId: string, input: BookmarkData): Promise<Bookmark> {
  return db.transaction(async (tx) => {
    await requireGroup(tx, groupId);
    if ((await count(tx, 'SELECT COUNT(*) AS n FROM bookmarks')) >= 20000) throw new AppError(400, 'limit_reached', 'The dashboard is limited to 20,000 bookmarks.');
    return getBookmark(tx, await insertBookmark(tx, groupId, input));
  });
}

export async function updateBookmark(db: DB, id: string, patch: Partial<BookmarkData>): Promise<Bookmark> {
  return db.transaction(async (tx) => {
    const cur = mapBookmark(await requireBookmarkRow(tx, id));
    const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Bookmark;
    await run(
      tx,
      `UPDATE bookmarks SET title = ?, url = ?, description = ?, environment = ?, owner = ?, icon = ?, tags = ?,
         favorite = ?, note = ?, is_sample = 0, updated_at = ? WHERE id = ?`,
      next.title, next.url, next.description, next.environment, next.owner, next.icon, JSON.stringify(next.tags),
      next.favorite ? 1 : 0, next.note, now(), id,
    );
    return getBookmark(tx, id);
  });
}

export async function moveBookmark(db: DB, id: string, to: { groupId: string; index: number }): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = await requireBookmarkRow(tx, id);
    await requireGroup(tx, to.groupId);
    if (to.groupId !== String(cur.group_id)) {
      await run(tx, 'UPDATE bookmarks SET group_id = ?, is_sample = 0, updated_at = ? WHERE id = ?', to.groupId, now(), id);
      await writeOrder(tx, 'bookmarks', await siblingIds(tx, 'bookmarks', 'group_id', String(cur.group_id)));
    }
    await placeAt(tx, 'bookmarks', 'group_id', to.groupId, id, to.index);
  });
}

export async function duplicateBookmark(db: DB, id: string): Promise<Bookmark> {
  return db.transaction(async (tx) => {
    const cur = await getBookmark(tx, id);
    const title = `${cur.title} (copy)`.slice(0, 120);
    const copyId = await insertBookmark(tx, cur.groupId, { ...cur, title, favorite: false });
    const index = (await siblingIds(tx, 'bookmarks', 'group_id', cur.groupId)).indexOf(id) + 1;
    await placeAt(tx, 'bookmarks', 'group_id', cur.groupId, copyId, index);
    return getBookmark(tx, copyId);
  });
}

export async function deleteBookmark(db: DB, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const cur = await requireBookmarkRow(tx, id);
    await run(tx, 'DELETE FROM bookmarks WHERE id = ?', id);
    await writeOrder(tx, 'bookmarks', await siblingIds(tx, 'bookmarks', 'group_id', String(cur.group_id)));
  });
}

export async function markOpened(db: DB, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requireBookmarkRow(tx, id);
    await run(tx, 'UPDATE bookmarks SET last_opened_at = ?, open_count = open_count + 1 WHERE id = ?', now(), id);
  });
}

/** Forgets the "recently opened" history (last-opened time and open counters) of every bookmark. Returns how many were reset. */
export async function clearRecent(db: DB): Promise<number> {
  return (await run(db, 'UPDATE bookmarks SET last_opened_at = NULL, open_count = 0 WHERE last_opened_at IS NOT NULL OR open_count > 0')).changes;
}

/* ----------------------------------------------------------- settings etc */

export const setTitle = (db: DB, title: string) => setMeta(db, 'title', title);

/** Removes only untouched sample content; anything the user edited or added is kept. */
export async function removeSampleData(db: DB): Promise<{ bookmarks: number; groups: number; workspaces: number }> {
  return db.transaction(async (tx) => {
    const bookmarks = (await run(tx, 'DELETE FROM bookmarks WHERE is_sample = 1')).changes;
    const groups = (await run(tx, 'DELETE FROM bookmark_groups WHERE is_sample = 1 AND NOT EXISTS (SELECT 1 FROM bookmarks WHERE group_id = bookmark_groups.id)')).changes;
    const workspaces = (await run(tx, 'DELETE FROM workspaces WHERE is_sample = 1 AND NOT EXISTS (SELECT 1 FROM bookmark_groups WHERE workspace_id = workspaces.id)')).changes;
    for (const w of await siblingIds(tx, 'workspaces', null, null)) {
      await writeOrder(tx, 'bookmark_groups', await siblingIds(tx, 'bookmark_groups', 'workspace_id', w));
    }
    for (const g of await all(tx, 'SELECT id FROM bookmark_groups')) {
      await writeOrder(tx, 'bookmarks', await siblingIds(tx, 'bookmarks', 'group_id', String(g.id)));
    }
    await writeOrder(tx, 'workspaces', await siblingIds(tx, 'workspaces', null, null));
    return { bookmarks, groups, workspaces };
  });
}

export async function countAll(db: DB): Promise<{ workspaces: number; groups: number; bookmarks: number }> {
  return {
    workspaces: await count(db, 'SELECT COUNT(*) AS n FROM workspaces'),
    groups: await count(db, 'SELECT COUNT(*) AS n FROM bookmark_groups'),
    bookmarks: await count(db, 'SELECT COUNT(*) AS n FROM bookmarks'),
  };
}
