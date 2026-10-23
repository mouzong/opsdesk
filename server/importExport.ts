import { z } from 'zod';
import { DEFAULT_WORKSPACE_ICON, EXPORT_FORMAT, EXPORT_VERSION, ICON_NAMES, LIMITS } from '../shared/constants.js';
import type {
  DuplicatePolicy, ImportBookmark, ImportMode, ImportPreview, ImportWorkspace,
} from '../shared/types.js';
import { urlKey } from '../shared/url.js';
import type { Executor as DB } from './db/types.js';
import { AppError } from './errors.js';
import { getDashboard, getTitle, insertBookmark, insertGroup, insertWorkspace, setMeta } from './repo.js';
import { bookmarkShape, parse } from './validation.js';

/* ---------------------------------------------------------------- export */

export async function buildExport(db: DB) {
  const d = await getDashboard(db);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'OpsDesk',
    dashboard: { title: d.title },
    workspaces: d.workspaces.map((w) => ({
      name: w.name,
      icon: w.icon,
      groups: w.groups.map((g) => ({
        name: g.name,
        collapsed: g.collapsed,
        bookmarks: g.bookmarks.map((b) => ({
          title: b.title,
          url: b.url,
          description: b.description,
          environment: b.environment,
          owner: b.owner,
          icon: b.icon,
          tags: b.tags,
          favorite: b.favorite,
          note: b.note,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        })),
      })),
    })),
  };
}

/* ------------------------------------------------------ import validation */

const lenientIcon = z.string().max(40).transform((v) => (ICON_NAMES.includes(v as never) ? v : null));
const isoDate = z.iso.datetime({ offset: true }).optional();

const importBookmarkSchema = z.object({
  ...bookmarkShape,
  icon: lenientIcon.nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
const importGroupSchema = z.object({
  name: bookmarkShape.title.pipe(z.string().max(LIMITS.name, `Name must be at most ${LIMITS.name} characters.`)),
  collapsed: z.boolean().optional(),
  bookmarks: z.array(importBookmarkSchema).max(LIMITS.bookmarksTotal),
});
const importWorkspaceSchema = z.object({
  name: bookmarkShape.title.pipe(z.string().max(LIMITS.name, `Name must be at most ${LIMITS.name} characters.`)),
  icon: lenientIcon.nullable().optional(),
  groups: z.array(importGroupSchema).max(LIMITS.groupsPerWorkspace, `At most ${LIMITS.groupsPerWorkspace} groups per workspace.`),
});
const exportFileSchema = z.object({
  format: z.literal(EXPORT_FORMAT, { error: 'This file is not an OpsDesk export.' }),
  version: z.number().int().min(1),
  dashboard: z.object({ title: bookmarkShape.title.pipe(z.string().max(LIMITS.dashboardTitle)) }).partial().optional(),
  workspaces: z.array(importWorkspaceSchema).max(LIMITS.workspaces, `At most ${LIMITS.workspaces} workspaces.`),
});

export interface ImportData {
  title?: string | undefined;
  workspaces: ImportWorkspace[];
}

export function parseExportFile(raw: unknown): ImportData {
  if (typeof raw !== 'object' || raw === null) throw new AppError(400, 'validation_error', 'The file is not a valid OpsDesk export.');
  const v = (raw as { version?: unknown }).version;
  if (typeof v === 'number' && v > EXPORT_VERSION) {
    throw new AppError(400, 'unsupported_version', `This export uses format version ${v}; this OpsDesk understands up to version ${EXPORT_VERSION}. Update OpsDesk first.`);
  }
  const file = parse(exportFileSchema, raw);
  let total = 0;
  const workspaces: ImportWorkspace[] = file.workspaces.map((w) => ({
    name: w.name,
    icon: w.icon ?? DEFAULT_WORKSPACE_ICON,
    groups: w.groups.map((g) => ({
      name: g.name,
      collapsed: g.collapsed ?? false,
      bookmarks: g.bookmarks.map((b): ImportBookmark => {
        total++;
        return {
          title: b.title,
          url: b.url,
          description: b.description ?? '',
          environment: b.environment ?? 'other',
          owner: b.owner ?? '',
          icon: b.icon ?? null,
          tags: b.tags ?? [],
          favorite: b.favorite ?? false,
          note: b.note ?? '',
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        };
      }),
    })),
  }));
  if (total > LIMITS.bookmarksTotal) {
    throw new AppError(400, 'limit_reached', `The file contains ${total} bookmarks; the limit is ${LIMITS.bookmarksTotal}.`);
  }
  return { title: file.dashboard?.title, workspaces };
}

/* ----------------------------------------------------------- apply logic */

export interface ApplyOptions {
  mode: ImportMode;
  duplicates: DuplicatePolicy;
  source: 'json' | 'html';
  warnings?: string[];
}
export interface ApplyHooks {
  /** Test seam: called after each bookmark is written; throw to simulate a mid-import failure. */
  afterBookmark?: (written: number) => void;
}

const lc = (s: string) => s.toLowerCase();

/**
 * Applies an import inside the caller's transaction. Any exception rolls back everything.
 * Merge rules: workspaces match by name, groups by name within the workspace (case-insensitive),
 * bookmarks by normalised URL within the matched group. Replace mode wipes then recreates.
 */
async function applyInTx(db: DB, data: ImportData, opts: ApplyOptions, hooks: ApplyHooks): Promise<ImportPreview> {
  const counts: ImportPreview['counts'] = {
    workspacesAdded: 0, workspacesExisting: 0, groupsAdded: 0, groupsExisting: 0,
    bookmarksAdded: 0, bookmarksUpdated: 0, bookmarksSkipped: 0,
    workspacesRemoved: 0, groupsRemoved: 0, bookmarksRemoved: 0,
  };
  const sample: string[] = [];
  const note = (line: string) => { if (sample.length < 25) sample.push(line); };
  let titleChange: ImportPreview['titleChange'] = null;

  const before = await getDashboard(db);
  if (opts.mode === 'replace') {
    counts.workspacesRemoved = before.workspaces.length;
    for (const w of before.workspaces) {
      counts.groupsRemoved += w.groups.length;
      for (const g of w.groups) counts.bookmarksRemoved += g.bookmarks.length;
    }
    await db.run('DELETE FROM workspaces');
    note(`- remove ${counts.workspacesRemoved} workspace(s), ${counts.groupsRemoved} group(s), ${counts.bookmarksRemoved} bookmark(s)`);
    if (data.title && data.title !== before.title) {
      titleChange = { from: before.title, to: data.title };
      await setMeta(db, 'title', data.title);
    }
  }

  let written = 0;
  for (const w of data.workspaces) {
    const current = await getDashboard(db);
    const ws = current.workspaces.find((x) => lc(x.name) === lc(w.name));
    let wsId: string;
    if (ws) {
      wsId = ws.id;
      counts.workspacesExisting++;
    } else {
      wsId = await insertWorkspace(db, { name: w.name, icon: w.icon });
      counts.workspacesAdded++;
      note(`+ workspace "${w.name}"`);
    }
    for (const g of w.groups) {
      const fresh = (await getDashboard(db)).workspaces.find((x) => x.id === wsId)!;
      const existingGroup = fresh.groups.find((x) => lc(x.name) === lc(g.name));
      let gId: string;
      if (existingGroup) {
        gId = existingGroup.id;
        counts.groupsExisting++;
      } else {
        gId = await insertGroup(db, wsId, { name: g.name, collapsed: g.collapsed });
        counts.groupsAdded++;
        note(`+ group "${w.name} / ${g.name}"`);
      }
      const existing = new Map<string, { id: string }>();
      const cur = (await getDashboard(db)).workspaces.find((x) => x.id === wsId)!.groups.find((x) => x.id === gId)!;
      for (const b of cur.bookmarks) existing.set(urlKey(b.url), { id: b.id });
      for (const b of g.bookmarks) {
        const key = urlKey(b.url);
        const match = existing.get(key);
        if (match) {
          if (opts.duplicates === 'update') {
            await db.run(
              `UPDATE bookmarks SET title = ?, description = ?, environment = ?, owner = ?, icon = ?, tags = ?, favorite = ?, note = ?, is_sample = 0, updated_at = ? WHERE id = ?`,
              [b.title, b.description, b.environment, b.owner, b.icon, JSON.stringify(b.tags), b.favorite ? 1 : 0, b.note, new Date().toISOString(), match.id],
            );
            counts.bookmarksUpdated++;
            note(`~ update "${b.title}" in ${w.name} / ${g.name}`);
          } else {
            counts.bookmarksSkipped++;
            note(`= duplicate kept as is: "${b.title}" in ${w.name} / ${g.name}`);
          }
        } else {
          const id = await insertBookmark(db, gId, b, { createdAt: b.createdAt, updatedAt: b.updatedAt });
          existing.set(key, { id });
          counts.bookmarksAdded++;
          note(`+ "${b.title}" in ${w.name} / ${g.name}`);
        }
        written++;
        hooks.afterBookmark?.(written);
      }
    }
  }

  const total = Number((await db.query('SELECT COUNT(*) AS n FROM bookmarks'))[0]?.n ?? 0);
  if (total > LIMITS.bookmarksTotal) throw new AppError(400, 'limit_reached', `The result would exceed ${LIMITS.bookmarksTotal} bookmarks.`);
  await setMeta(db, 'setup', 'done');
  return { source: opts.source, mode: opts.mode, duplicates: opts.duplicates, counts, titleChange, warnings: opts.warnings ?? [], sample };
}

/** Exact preview: runs the real import and rolls it back. */
export function previewImport(db: DB, data: ImportData, opts: ApplyOptions): Promise<ImportPreview> {
  return db.transaction((tx) => applyInTx(tx, data, opts, {}), { rollback: true });
}

export function applyImport(db: DB, data: ImportData, opts: ApplyOptions, hooks: ApplyHooks = {}): Promise<ImportPreview> {
  return db.transaction((tx) => applyInTx(tx, data, opts, hooks));
}

export { getTitle };
