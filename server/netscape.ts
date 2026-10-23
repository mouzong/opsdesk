import { Parser } from 'htmlparser2';
import { LIMITS } from '../shared/constants.js';
import type { ImportGroup, ImportWorkspace } from '../shared/types.js';
import { bookmarkCreate, cleanText } from './validation.js';

interface RawLink { folder: string; href: string; title: string; tags: string; description: string }

export interface ParsedBookmarkHtml {
  workspaces: ImportWorkspace[];
  found: number;
  warnings: string[];
}

/**
 * Parses a Netscape bookmark file (Chrome, Edge, Firefox, Safari exports) into plain data.
 * The markup is only tokenised - never rendered, evaluated or fetched.
 */
export function parseNetscapeBookmarks(html: string, workspaceName: string): ParsedBookmarkHtml {
  const links: RawLink[] = [];
  const stack: string[] = [];
  let pendingFolder: string | null = null;
  let mode: 'none' | 'h3' | 'a' | 'dd' = 'none';
  let text = '';
  let current: RawLink | null = null;
  let last: RawLink | null = null;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === 'dl') {
          stack.push(pendingFolder ?? '');
          pendingFolder = null;
        } else if (name === 'h3') {
          mode = 'h3';
          text = '';
        } else if (name === 'a') {
          mode = 'a';
          text = '';
          current = { folder: stack.filter(Boolean).join(' / '), href: attribs.href ?? '', title: '', tags: attribs.tags ?? '', description: '' };
        } else if (name === 'dd') {
          mode = 'dd';
          text = '';
        }
      },
      ontext(data) {
        if (mode !== 'none') text += data;
      },
      onclosetag(name) {
        if (name === 'h3' && mode === 'h3') {
          pendingFolder = text.trim();
          mode = 'none';
        } else if (name === 'a' && mode === 'a' && current) {
          current.title = text.trim();
          links.push(current);
          last = current;
          current = null;
          mode = 'none';
        } else if (name === 'dd' && mode === 'dd') {
          if (last) last.description = text.trim();
          mode = 'none';
        } else if (name === 'dl') {
          stack.pop();
          pendingFolder = null;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const warnings: string[] = [];
  let unsupported = 0;
  let invalid = 0;
  const groups = new Map<string, ImportGroup>();
  const groupFor = (folder: string): ImportGroup => {
    const name = (folder || 'Imported').slice(0, LIMITS.name);
    let g = groups.get(name);
    if (!g) {
      g = { name, collapsed: false, bookmarks: [] };
      groups.set(name, g);
    }
    return g;
  };

  for (const l of links) {
    if (!/^https?:\/\//i.test(l.href.trim())) {
      unsupported++;
      continue;
    }
    const parsed = bookmarkCreate.safeParse({
      title: cleanText(l.title).slice(0, LIMITS.title) || safeHost(l.href),
      url: l.href,
      description: cleanText(l.description).slice(0, LIMITS.description),
      tags: l.tags ? l.tags.split(',').slice(0, LIMITS.tagsPerBookmark).map((t) => cleanText(t).slice(0, LIMITS.tag)) : [],
    });
    if (!parsed.success) {
      invalid++;
      continue;
    }
    const d = parsed.data;
    groupFor(l.folder).bookmarks.push({
      title: d.title,
      url: d.url,
      description: d.description ?? '',
      environment: 'other',
      owner: '',
      icon: null,
      tags: d.tags ?? [],
      favorite: false,
      note: '',
    });
  }

  if (unsupported > 0) warnings.push(`${unsupported} link(s) skipped: only http:// and https:// addresses are imported.`);
  if (invalid > 0) warnings.push(`${invalid} link(s) skipped because their address or fields were invalid.`);

  let list = [...groups.values()];
  if (list.length > LIMITS.groupsPerWorkspace) {
    const keep = list.slice(0, LIMITS.groupsPerWorkspace - 1);
    const rest = list.slice(LIMITS.groupsPerWorkspace - 1);
    keep.push({ name: 'Other imported', collapsed: false, bookmarks: rest.flatMap((g) => g.bookmarks) });
    list = keep;
    warnings.push('Too many folders: the smallest folders were combined into "Other imported".');
  }
    return {
    workspaces: list.length ? [{ name: workspaceName, icon: 'bookmark', groups: list }] : [],
    found: links.length,
    warnings,
  };
}

function safeHost(href: string): string {
  try {
    return new URL(href).host || href.slice(0, 60);
  } catch {
    return href.slice(0, 60);
  }
}
