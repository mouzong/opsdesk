import { createHash } from 'node:crypto';
import type { Executor } from '../db/types.js';
import * as repo from '../repo.js';

export type EtagKind = 'workspace' | 'group' | 'bookmark';

/**
 * Weak validator over the fields a client can edit on the resource itself (not its children, not its position),
 * so renaming a workspace is not blocked by an unrelated bookmark change inside it.
 */
export function etagOf(kind: EtagKind, r: any): string {
  const view =
    kind === 'workspace' ? { id: r.id, name: r.name, icon: r.icon }
    : kind === 'group' ? { id: r.id, workspaceId: r.workspaceId, name: r.name, collapsed: r.collapsed }
    : { ...r, lastOpenedAt: undefined, openCount: undefined };
  return `W/"${createHash('sha1').update(JSON.stringify(view)).digest('hex').slice(0, 20)}"`;
}

export async function currentEtag(db: Executor, kind: EtagKind, id: string): Promise<string | undefined> {
  try {
    const r = kind === 'workspace' ? await repo.getWorkspace(db, id) : kind === 'group' ? await repo.getGroup(db, id) : await repo.getBookmark(db, id);
    return etagOf(kind, r);
  } catch {
    return undefined; // not found: the handler reports 404
  }
}

/** If-Match semantics: "*" or any listed validator must equal the current one (weak comparison). */
export function ifMatchSatisfied(header: string, current: string | undefined): boolean {
  if (current === undefined) return true;
  if (header.trim() === '*') return true;
  const norm = (t: string) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => norm(t) === norm(current));
}
