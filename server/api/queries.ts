import { z } from 'zod';
import { ENVIRONMENTS, type Environment } from '../../shared/constants.js';
import { bookmarkMatches, EMPTY_FILTERS } from '../../shared/search.js';
import type { Bookmark, Dashboard } from '../../shared/types.js';

export const intQ = (def: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(def);
export const boolQ = z.enum(['true', 'false']).transform((v) => v === 'true').meta({ type: 'boolean' });
const csv = (max = 600) => z.string().max(max).transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

export const pageQuery = {
  limit: intQ(50, 1, 200).meta({ description: 'Page size (1-200).' }),
  offset: intQ(0, 0, 1_000_000).meta({ description: 'Number of items to skip.' }),
};
export const orderQuery = z.enum(['asc', 'desc']).default('asc').meta({ description: 'Sort direction.' });

export const envCsv = csv(200).pipe(z.array(z.enum(ENVIRONMENTS)).max(6)).meta({
  type: 'string', description: 'Comma-separated environments; a bookmark matches ANY of them.', example: 'production,preproduction',
});
export const tagCsv = csv(700).pipe(z.array(z.string().max(32)).max(20)).meta({
  type: 'string', description: 'Comma-separated tags; a bookmark must have ALL of them (case-insensitive).', example: 'elastic,logs',
});

export interface Page { limit: number; offset: number; total: number; hasMore: boolean }
export function paginate<T>(items: T[], limit: number, offset: number): { items: T[]; page: Page } {
  const slice = items.slice(offset, offset + limit);
  return { items: slice, page: { limit, offset, total: items.length, hasMore: offset + slice.length < items.length } };
}

export type BookmarkItem = Bookmark & { workspaceId: string; workspaceName: string; groupName: string };

/** Bookmarks in display order (workspace, group, bookmark position) with their location. */
export function flatten(d: Dashboard): BookmarkItem[] {
  return d.workspaces.flatMap((w) => w.groups.flatMap((g) => g.bookmarks.map((b) => ({ ...b, workspaceId: w.id, workspaceName: w.name, groupName: g.name }))));
}

export interface BookmarkQuery {
  q?: string | undefined;
  workspaceId?: string | undefined;
  groupId?: string | undefined;
  environment?: Environment[] | undefined;
  tag?: string[] | undefined;
  favorite?: boolean | undefined;
  sort: 'position' | 'title' | 'createdAt' | 'updatedAt' | 'lastOpenedAt' | 'openCount';
  order: 'asc' | 'desc';
}

/** Same matching rules as the UI search (shared/search.ts), plus location filters and sorting. */
export function searchBookmarks(d: Dashboard, q: BookmarkQuery): BookmarkItem[] {
  const filters = { ...EMPTY_FILTERS, query: q.q ?? '', environments: q.environment ?? [], tags: q.tag ?? [], favoritesOnly: q.favorite === true };
  let items = flatten(d).filter((b) => (!q.workspaceId || b.workspaceId === q.workspaceId) && (!q.groupId || b.groupId === q.groupId));
  items = items.filter((b) => bookmarkMatches(b, filters) && (q.favorite !== false || !b.favorite));
  if (q.sort !== 'position') {
    const dir = q.order === 'desc' ? -1 : 1;
    const key = (b: BookmarkItem): string | number | null =>
      q.sort === 'title' ? b.title.toLowerCase()
      : q.sort === 'openCount' ? b.openCount
      : q.sort === 'createdAt' ? b.createdAt
      : q.sort === 'updatedAt' ? b.updatedAt
      : b.lastOpenedAt;
    items = items
      .map((b, i) => ({ b, i }))
      .sort((x, y) => {
        const a = key(x.b), c = key(y.b);
        if (a === c) return x.i - y.i;
        if (a === null) return 1; // nulls last in both directions
        if (c === null) return -1;
        return (a < c ? -1 : 1) * dir;
      })
      .map((x) => x.b);
  } else if (q.order === 'desc') items = [...items].reverse();
  return items;
}
