import type { Environment } from './constants.js';
import type { Bookmark, Dashboard, Group, Workspace } from './types.js';

export type SearchScope = 'workspace' | 'all';

export interface FilterState {
  query: string;
  scope: SearchScope;
  environments: Environment[];
  tags: string[];
  favoritesOnly: boolean;
}

export const EMPTY_FILTERS: FilterState = {
  query: '',
  scope: 'workspace',
  environments: [],
  tags: [],
  favoritesOnly: false,
};

export function hasActiveCriteria(f: FilterState): boolean {
  return f.query.trim() !== '' || f.environments.length > 0 || f.tags.length > 0 || f.favoritesOnly;
}

export function hasActiveFilters(f: FilterState): boolean {
  return f.environments.length > 0 || f.tags.length > 0 || f.favoritesOnly;
}

function haystack(b: Bookmark): string {
  return [b.title, b.description, b.url, b.owner, ...b.tags].join('\n').toLowerCase();
}

/**
 * Search rules (documented in README):
 *  - query is split on whitespace; every term must appear (AND) in title, description, URL, tags or owner
 *  - environment filter: bookmark matches ANY selected environment
 *  - tag filter: bookmark must carry ALL selected tags
 *  - favorites filter: only pinned bookmarks
 *  - all criteria combine with AND
 */
export function bookmarkMatches(b: Bookmark, f: FilterState): boolean {
  if (f.favoritesOnly && !b.favorite) return false;
  if (f.environments.length > 0 && !f.environments.includes(b.environment)) return false;
  if (f.tags.length > 0) {
    const have = new Set(b.tags.map((t) => t.toLowerCase()));
    if (!f.tags.every((t) => have.has(t.toLowerCase()))) return false;
  }
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    const text = haystack(b);
    if (!terms.every((t) => text.includes(t))) return false;
  }
  return true;
}

/**
 * Returns the workspaces (and groups) to display. Scope 'workspace' restricts to the current
 * workspace; 'all' spans every workspace. Empty groups/workspaces are dropped while criteria are active.
 */
export function applyFilters(d: Dashboard, f: FilterState, currentWorkspaceId: string | null): Workspace[] {
  const active = hasActiveCriteria(f);
  const inScope = d.workspaces.filter((w) => f.scope === 'all' || w.id === currentWorkspaceId);
  if (!active) return inScope;
  const out: Workspace[] = [];
  for (const w of inScope) {
    const groups: Group[] = [];
    for (const g of w.groups) {
      const bookmarks = g.bookmarks.filter((b) => bookmarkMatches(b, f));
      if (bookmarks.length > 0) groups.push({ ...g, bookmarks });
    }
    if (groups.length > 0) out.push({ ...w, groups });
  }
  return out;
}

export function countBookmarks(ws: Workspace[]): number {
  return ws.reduce((n, w) => n + w.groups.reduce((m, g) => m + g.bookmarks.length, 0), 0);
}

/** Tags with usage counts across the given workspaces, most used first. */
export function collectTags(ws: Workspace[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const w of ws) for (const g of w.groups) for (const b of g.bookmarks) for (const t of b.tags) {
    const key = t.toLowerCase();
    const e = counts.get(key);
    if (e) e.count++;
    else counts.set(key, { tag: t, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function allBookmarks(d: Dashboard): (Bookmark & { workspaceId: string; workspaceName: string; groupName: string })[] {
  return d.workspaces.flatMap((w) =>
    w.groups.flatMap((g) => g.bookmarks.map((b) => ({ ...b, workspaceId: w.id, workspaceName: w.name, groupName: g.name }))),
  );
}
