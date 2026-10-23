import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, CopyPlus, ExternalLink, EllipsisVertical, FolderInput, FolderPlus,
  GripVertical, Info, Pencil, Plus, SearchX, Star, StickyNote, Trash2,
} from 'lucide-react';
import { createContext, useContext, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { applyFilters, countBookmarks, hasActiveCriteria } from '../../../shared/search';
import type { Bookmark, Group, Workspace } from '../../../shared/types';
import { hasIcon, NamedIcon } from '../icons';
import { useStore } from '../store';
import { copyText, displayHost, initials, plural } from '../util';
import { EnvBadge, Menu, type MenuItem } from './ui';

/* ----------------------------------------------------------------- drag & drop */

type Drag = { type: 'bookmark' | 'group'; id: string } | null;
const DndContext = createContext<{
  drag: Drag;
  setDrag: (d: Drag) => void;
  over: string | null;
  setOver: (id: string | null) => void;
  enabled: boolean;
}>({ drag: null, setDrag: () => {}, over: null, setOver: () => {}, enabled: false });

/* ------------------------------------------------------------------- bookmark card */

interface CardProps {
  bookmark: Bookmark;
  group?: Group;
  /** Index among the group's (unfiltered) bookmarks - used for ordering controls. */
  index?: number;
  count?: number;
  subtitle?: string;
  mini?: boolean;
}

export function openBookmark(b: Bookmark, record: (id: string) => void) {
  window.open(b.url, '_blank', 'noopener,noreferrer');
  record(b.id);
}

export function BookmarkCard({ bookmark: b, group, index = 0, count = 1, subtitle, mini }: CardProps) {
  const { actions, openDialog, run, toast, findBookmark } = useStore();
  const dnd = useContext(DndContext);
  const draggable = dnd.enabled && !mini && !!group;
  const dropHere = dnd.over === b.id && dnd.drag?.type === 'bookmark' && dnd.drag.id !== b.id;

  const items: MenuItem[] = [
    { label: 'Open in new tab', icon: <ExternalLink size={16} />, onSelect: () => openBookmark(b, actions.recordOpen) },
    { label: 'Details and note', icon: <Info size={16} />, onSelect: () => openDialog({ type: 'details', bookmarkId: b.id }) },
    { label: 'Edit...', icon: <Pencil size={16} />, onSelect: () => openDialog({ type: 'bookmark', mode: 'edit', bookmarkId: b.id }), separatorBefore: true },
    { label: 'Duplicate', icon: <CopyPlus size={16} />, onSelect: () => void run(() => actions.duplicateBookmark(b.id), 'Bookmark duplicated.') },
    { label: 'Move to group...', icon: <FolderInput size={16} />, onSelect: () => openDialog({ type: 'move-bookmark', bookmarkId: b.id }) },
  ];
  if (!mini && group) {
    items.push(
      { label: 'Move earlier', icon: <ArrowUp size={16} />, disabled: index === 0, onSelect: () => void run(() => actions.moveBookmark(b.id, group.id, index - 1)) },
      { label: 'Move later', icon: <ArrowDown size={16} />, disabled: index >= count - 1, onSelect: () => void run(() => actions.moveBookmark(b.id, group.id, index + 1)) },
    );
  }
  items.push({ label: 'Delete...', icon: <Trash2 size={16} />, danger: true, separatorBefore: true, onSelect: () => openDialog({ type: 'delete-bookmark', bookmarkId: b.id }) });

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', b.id);
    e.dataTransfer.effectAllowed = 'move';
    dnd.setDrag({ type: 'bookmark', id: b.id });
  };
  const onDragOver = (e: DragEvent) => {
    if (dnd.drag?.type !== 'bookmark' || !group) return;
    e.preventDefault();
    e.stopPropagation();
    if (dnd.over !== b.id) dnd.setOver(b.id);
  };
  const onDrop = (e: DragEvent) => {
    if (dnd.drag?.type !== 'bookmark' || !group) return;
    e.preventDefault();
    e.stopPropagation();
    const dragged = dnd.drag.id;
    dnd.setDrag(null);
    dnd.setOver(null);
    if (dragged === b.id) return;
    const sameGroup = findBookmark(dragged)?.group.id === group.id;
    const from = group.bookmarks.findIndex((x) => x.id === dragged);
    const target = sameGroup && from !== -1 && from < index ? index - 1 : index;
    void run(() => actions.moveBookmark(dragged, group.id, target));
  };

  const dim = !mini;
  return (
    <article
      className={`card${b.environment === 'production' ? ' card-prod' : ''}${dropHere ? ' drop-before' : ''}${dnd.drag?.id === b.id ? ' dragging' : ''}${mini ? ' card-mini' : ''}`}
      data-env={b.environment}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={() => { dnd.setDrag(null); dnd.setOver(null); }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <a
        className="card-main"
        href={b.url}
        target="_blank"
        rel="noopener noreferrer"
        data-nav
        title={b.description ? `${b.title}\n${b.description}` : b.title}
        onClick={() => void actions.recordOpen(b.id)}
        onAuxClick={(e) => { if (e.button === 1) void actions.recordOpen(b.id); }}
      >
        <span className={`card-icon${hasIcon(b.icon) ? '' : ' initials'}`} aria-hidden="true">
          {hasIcon(b.icon) ? <NamedIcon name={b.icon} size={18} /> : initials(b.title)}
        </span>
        <span className="card-text">
          <span className="card-title">{b.title}</span>
          <span className="card-host">{displayHost(b.url)}</span>
        </span>
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <div className="card-side">
        <EnvBadge env={b.environment} compact />
        {b.isSample && <span className="sample-badge" title="Sample content - remove it in Settings">Sample</span>}
      </div>
      {dim && b.description && <p className="card-desc">{b.description}</p>}
      {(subtitle || (dim && (b.owner || b.tags.length > 0))) && (
        <div className="card-meta">
          {subtitle && <span className="card-where">{subtitle}</span>}
          {dim && b.owner && <span className="card-owner" title="Service owner / team">{b.owner}</span>}
          {dim && b.tags.map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
      )}
      <div className="card-actions">
        {b.note && (
          <button type="button" className="icon-btn" aria-label={`Show note for ${b.title}`} title="Has an operational note" onClick={() => openDialog({ type: 'details', bookmarkId: b.id })}>
            <StickyNote size={16} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={`icon-btn star${b.favorite ? ' on' : ''}`}
          aria-pressed={b.favorite}
          aria-label={b.favorite ? `Unpin ${b.title}` : `Pin ${b.title}`}
          title={b.favorite ? 'Unpin' : 'Pin to top'}
          onClick={() => void run(() => actions.updateBookmark(b.id, { favorite: !b.favorite }))}
        >
          <Star size={16} aria-hidden="true" fill={b.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={`Copy URL of ${b.title}`}
          title="Copy URL"
          onClick={async () => {
            const ok = await copyText(b.url);
            toast(ok ? 'success' : 'error', ok ? 'URL copied to the clipboard.' : 'Could not copy - select the URL in the details view instead.');
          }}
        >
          <Copy size={16} aria-hidden="true" />
        </button>
        <Menu label={`Actions for ${b.title}`} trigger={<EllipsisVertical size={16} aria-hidden="true" />} items={items} />
      </div>
    </article>
  );
}

/* ---------------------------------------------------------------------- group section */

function GroupSection({ group, workspace, index, count, shown, filtering, showWorkspace }: {
  group: Group;
  workspace: Workspace;
  index: number;
  count: number;
  shown: Bookmark[];
  filtering: boolean;
  showWorkspace: boolean;
}) {
  const { actions, openDialog, run, dashboard } = useStore();
  const dnd = useContext(DndContext);
  const collapsed = group.collapsed && !filtering;
  const headId = `group-${group.id}`;
  const groupDropHere = dnd.over === `g:${group.id}` && dnd.drag?.type === 'group' && dnd.drag.id !== group.id;
  const bodyDropHere = dnd.over === `body:${group.id}` && dnd.drag?.type === 'bookmark';

  const items: MenuItem[] = [
    { label: 'Add bookmark', icon: <Plus size={16} />, onSelect: () => openDialog({ type: 'bookmark', mode: 'create', groupId: group.id }) },
    { label: 'Rename group...', icon: <Pencil size={16} />, onSelect: () => openDialog({ type: 'name', kind: 'group-rename', id: group.id }) },
    { label: 'Move up', icon: <ArrowUp size={16} />, disabled: index === 0, separatorBefore: true, onSelect: () => void run(() => actions.moveGroup(group.id, undefined, index - 1)) },
    { label: 'Move down', icon: <ArrowDown size={16} />, disabled: index >= count - 1, onSelect: () => void run(() => actions.moveGroup(group.id, undefined, index + 1)) },
    { label: 'Move to workspace...', icon: <FolderInput size={16} />, disabled: (dashboard?.workspaces.length ?? 0) < 2, onSelect: () => openDialog({ type: 'move-group', id: group.id }) },
    { label: 'Delete group...', icon: <Trash2 size={16} />, danger: true, separatorBefore: true, onSelect: () => openDialog({ type: 'delete-structure', kind: 'group', id: group.id }) },
  ];

  const onHeaderDragOver = (e: DragEvent) => {
    if (dnd.drag?.type === 'group') { e.preventDefault(); if (dnd.over !== `g:${group.id}`) dnd.setOver(`g:${group.id}`); }
    else if (dnd.drag?.type === 'bookmark') { e.preventDefault(); if (dnd.over !== `body:${group.id}`) dnd.setOver(`body:${group.id}`); }
  };
  const onHeaderDrop = (e: DragEvent) => {
    e.preventDefault();
    const d = dnd.drag;
    dnd.setDrag(null); dnd.setOver(null);
    if (!d) return;
    if (d.type === 'group' && d.id !== group.id) {
      const cur = dashboard?.workspaces.flatMap((w) => w.groups).find((g) => g.id === d.id);
      const sameWs = cur?.workspaceId === workspace.id;
      const from = workspace.groups.findIndex((g) => g.id === d.id);
      const target = sameWs && from !== -1 && from < index ? index - 1 : index;
      void run(() => actions.moveGroup(d.id, workspace.id, target));
    } else if (d.type === 'bookmark') void run(() => actions.moveBookmark(d.id, group.id, 9999));
  };

  return (
    <section className={`group${groupDropHere ? ' drop-before' : ''}${bodyDropHere ? ' drop-into' : ''}`} aria-labelledby={headId}>
      <header className="group-head" onDragOver={onHeaderDragOver} onDrop={onHeaderDrop}>
        {dnd.enabled && (
          <span
            className="grip"
            draggable
            aria-hidden="true"
            title="Drag to reorder (or use the group menu)"
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', group.id);
              e.dataTransfer.effectAllowed = 'move';
              const section = (e.currentTarget as HTMLElement).closest('section');
              if (section) e.dataTransfer.setDragImage(section, 16, 16);
              dnd.setDrag({ type: 'group', id: group.id });
            }}
            onDragEnd={() => { dnd.setDrag(null); dnd.setOver(null); }}
          >
            <GripVertical size={16} />
          </span>
        )}
        <h3 id={headId} className="group-title">
          {filtering ? (
            <span className="group-toggle static">
              {showWorkspace && <span className="crumb">{workspace.name}<ChevronRight size={14} aria-hidden="true" /></span>}
              {group.name}
            </span>
          ) : (
            <button type="button" className="group-toggle" aria-expanded={!collapsed} onClick={() => void run(() => actions.updateGroup(group.id, { collapsed: !group.collapsed }))}>
              {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              {group.name}
            </button>
          )}
          <span className="count" aria-label={plural(shown.length, 'bookmark')}>{filtering && shown.length !== group.bookmarks.length ? `${shown.length}/${group.bookmarks.length}` : group.bookmarks.length}</span>
        </h3>
        <div className="group-actions">
          <button type="button" className="icon-btn" aria-label={`Add bookmark to ${group.name}`} title="Add bookmark" onClick={() => openDialog({ type: 'bookmark', mode: 'create', groupId: group.id })}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <Menu label={`Actions for group ${group.name}`} trigger={<EllipsisVertical size={16} aria-hidden="true" />} items={items} />
        </div>
      </header>
      {!collapsed && (
        <div
          className="grid"
          onDragOver={(e) => { if (dnd.drag?.type === 'bookmark') { e.preventDefault(); if (dnd.over !== `body:${group.id}`) dnd.setOver(`body:${group.id}`); } }}
          onDrop={(e) => {
            if (dnd.drag?.type !== 'bookmark') return;
            e.preventDefault();
            const id = dnd.drag.id;
            dnd.setDrag(null); dnd.setOver(null);
            void run(() => actions.moveBookmark(id, group.id, 9999));
          }}
        >
          {shown.map((b) => (
            <BookmarkCard key={b.id} bookmark={b} group={group} index={group.bookmarks.findIndex((x) => x.id === b.id)} count={group.bookmarks.length} />
          ))}
          {group.bookmarks.length === 0 && (
            <div className="group-empty">
              <span>No bookmarks in this group yet.</span>
              <button type="button" className="btn btn-sm" onClick={() => openDialog({ type: 'bookmark', mode: 'create', groupId: group.id })}>
                <Plus size={14} aria-hidden="true" /> Add bookmark
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- pinned/recent */

function QuickSection({ title, id, bookmarks, hint }: { title: string; id: string; bookmarks: { b: Bookmark; where: string }[]; hint?: string }) {
  const [open, setOpen] = useState(true);
  if (bookmarks.length === 0) return null;
  return (
    <section className="group quick" aria-labelledby={id}>
      <header className="group-head">
        <h3 id={id} className="group-title">
          <button type="button" className="group-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
            {title}
          </button>
          <span className="count">{bookmarks.length}</span>
          {hint && <span className="hint">{hint}</span>}
        </h3>
      </header>
      {open && (
        <div className="grid">
          {bookmarks.map(({ b, where }) => <BookmarkCard key={b.id} bookmark={b} mini subtitle={where} />)}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------------- main view */

export function moveFocus(e: KeyboardEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  if (!target.matches?.('[data-nav]')) return;
  const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const dir = dirs[e.key];
  if (!dir) return;
  const [dirX, dirY] = dir;
  const here = target.getBoundingClientRect();
  const cx = here.left + here.width / 2;
  const cy = here.top + here.height / 2;
  let best: { el: HTMLElement; score: number } | null = null;
  for (const el of document.querySelectorAll<HTMLElement>('[data-nav]')) {
    if (el === target || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const main = dirX !== 0 ? dx * dirX : dy * dirY;
    const cross = dirX !== 0 ? Math.abs(dy) : Math.abs(dx);
    if (main <= 4) continue;
    const score = main + cross * 3;
    if (!best || score < best.score) best = { el, score };
  }
  if (best) {
    e.preventDefault();
    best.el.focus();
    best.el.scrollIntoView({ block: 'nearest' });
  }
}

export function DashboardView() {
  const { dashboard, workspace, filters, setFilters, clearFilters, openDialog } = useStore();
  const [drag, setDrag] = useState<Drag>(null);
  const [over, setOver] = useState<string | null>(null);
  const active = hasActiveCriteria(filters);

  const shown = useMemo(() => (dashboard ? applyFilters(dashboard, filters, workspace?.id ?? null) : []), [dashboard, filters, workspace]);
  const total = countBookmarks(shown);

  const pinned = useMemo(() => {
    if (!dashboard) return [];
    return dashboard.workspaces.flatMap((w) => w.groups.flatMap((g) => g.bookmarks.filter((b) => b.favorite).map((b) => ({ b, where: `${w.name} / ${g.name}` }))));
  }, [dashboard]);
  const recent = useMemo(() => {
    if (!dashboard) return [];
    const idx = new Map<string, { b: Bookmark; where: string }>();
    for (const w of dashboard.workspaces) for (const g of w.groups) for (const b of g.bookmarks) idx.set(b.id, { b, where: `${w.name} / ${g.name}` });
    return dashboard.recent.slice(0, 8).map((id) => idx.get(id)).filter((x): x is { b: Bookmark; where: string } => !!x);
  }, [dashboard]);

  if (!dashboard) return null;

  if (dashboard.workspaces.length === 0) {
    return (
      <div className="empty">
        <h2>No workspaces yet</h2>
        <p>Workspaces separate areas such as Daily Operations, Observability or Infrastructure. Create one to start adding bookmarks.</p>
        <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'name', kind: 'workspace-create' })}>
          <Plus size={16} aria-hidden="true" /> Create workspace
        </button>
      </div>
    );
  }
  if (!workspace) return null;

  const dndEnabled = !active;

  if (active) {
    const scopeLabel = filters.scope === 'all' ? 'all workspaces' : `workspace "${workspace.name}"`;
    return (
      <DndContext.Provider value={{ drag, setDrag, over, setOver, enabled: false }}>
        <div className="results-head" role="status" aria-live="polite">
          <h2>{total === 0 ? 'No results' : `${plural(total, 'result')}`}<span className="muted"> in {scopeLabel}</span></h2>
        </div>
        {total === 0 ? (
          <div className="empty">
            <SearchX size={32} aria-hidden="true" />
            <h2>No bookmarks match</h2>
            <p>Nothing in {scopeLabel} matches the current search and filters.</p>
            <div className="row">
              {filters.scope === 'workspace' && dashboard.workspaces.length > 1 && (
                <button type="button" className="btn" onClick={() => setFilters({ scope: 'all' })}>Search all workspaces</button>
              )}
              {(filters.environments.length > 0 || filters.tags.length > 0 || filters.favoritesOnly) && (
                <button type="button" className="btn" onClick={clearFilters}>Clear filters</button>
              )}
              {filters.query && <button type="button" className="btn" onClick={() => setFilters({ query: '' })}>Reset search</button>}
            </div>
          </div>
        ) : (
          shown.map((w) => w.groups.map((g) => {
            const full = dashboard.workspaces.find((x) => x.id === w.id)!.groups.find((x) => x.id === g.id)!;
            return <GroupSection key={g.id} group={full} workspace={w} index={0} count={1} shown={g.bookmarks} filtering showWorkspace={filters.scope === 'all'} />;
          }))
        )}
      </DndContext.Provider>
    );
  }

  const ws = workspace;
  return (
    <DndContext.Provider value={{ drag, setDrag, over, setOver, enabled: dndEnabled }}>
      <QuickSection title="Pinned" id="sec-pinned" bookmarks={pinned} />
      <QuickSection title="Recently opened" id="sec-recent" bookmarks={recent} hint="launched from this dashboard" />
      <div className="ws-head">
        <h2>{ws.name}</h2>
        <span className="muted">{plural(ws.groups.length, 'group')}, {plural(countBookmarks([ws]), 'bookmark')}</span>
        <div className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => openDialog({ type: 'name', kind: 'group-create', workspaceId: ws.id })}>
          <FolderPlus size={14} aria-hidden="true" /> Add group
        </button>
      </div>
      {ws.groups.length === 0 ? (
        <div className="empty">
          <h2>This workspace is empty</h2>
          <p>Groups organise bookmarks inside a workspace, for example "Elastic Stack" or "Runbooks".</p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'name', kind: 'group-create', workspaceId: ws.id })}>
              <FolderPlus size={16} aria-hidden="true" /> Create group
            </button>
            <button type="button" className="btn" onClick={() => openDialog({ type: 'bookmark', mode: 'create' })}>
              <Plus size={16} aria-hidden="true" /> Add bookmark
            </button>
          </div>
        </div>
      ) : (
        <div onDragEnd={() => { setDrag(null); setOver(null); }}>
          {ws.groups.map((g, i) => (
            <GroupSection key={g.id} group={g} workspace={ws} index={i} count={ws.groups.length} shown={g.bookmarks} filtering={false} showWorkspace={false} />
          ))}
        </div>
      )}
    </DndContext.Provider>
  );
}
