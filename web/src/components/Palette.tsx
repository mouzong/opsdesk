import { CornerDownLeft, FolderPlus, LayoutGrid, Moon, Plus, Search, Settings } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { bookmarkMatches, EMPTY_FILTERS, allBookmarks } from '../../../shared/search';
import { NamedIcon } from '../icons';
import { navigate, workspacePath } from '../router';
import { useStore } from '../store';
import { displayHost } from '../util';
import { openBookmark } from './Dashboard';
import { EnvBadge } from './ui';

interface Item {
  key: string;
  label: string;
  detail?: string;
  icon: ReactNode;
  badge?: ReactNode;
  run: () => void;
}

export function Palette() {
  const { dashboard, workspace, actions, closeDialog, openDialog, setPrefs, prefs, setFilters } = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dlg = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    if (dlg && !dlg.open) dlg.showModal();
    return () => {
      if (dlg?.open) dlg.close();
      prev?.focus?.();
    };
  }, []);

  const items = useMemo<Item[]>(() => {
    if (!dashboard) return [];
    const term = q.trim().toLowerCase();
    const commands: Item[] = [
      { key: 'c-new', label: 'New bookmark', icon: <Plus size={16} />, run: () => openDialog({ type: 'bookmark', mode: 'create' }) },
      { key: 'c-group', label: 'New group in current workspace', icon: <FolderPlus size={16} />, run: () => workspace && openDialog({ type: 'name', kind: 'group-create', workspaceId: workspace.id }) },
      { key: 'c-ws', label: 'New workspace', icon: <Plus size={16} />, run: () => openDialog({ type: 'name', kind: 'workspace-create' }) },
      { key: 'c-set', label: 'Open settings, import and backups', icon: <Settings size={16} />, run: () => { closeDialog(); navigate('/settings'); } },
      { key: 'c-home', label: 'Go to workspace selection', icon: <LayoutGrid size={16} />, run: () => { closeDialog(); navigate('/'); } },
      { key: 'c-theme', label: `Switch theme (currently ${prefs.theme})`, icon: <Moon size={16} />, run: () => { setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }); closeDialog(); } },
      { key: 'c-dens', label: `Switch to ${prefs.density === 'compact' ? 'comfortable' : 'compact'} layout`, icon: <LayoutGrid size={16} />, run: () => { setPrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' }); closeDialog(); } },
    ];
    const wsItems: Item[] = dashboard.workspaces.map((w) => ({
      key: `w-${w.id}`, label: `Go to ${w.name}`, detail: 'workspace', icon: <NamedIcon name={w.icon} size={16} />,
      run: () => { setFilters({ query: '' }); closeDialog(); navigate(workspacePath(w.id)); },
    }));
    const all = allBookmarks(dashboard);
    const toItem = (b: (typeof all)[number]): Item => ({
      key: `b-${b.id}`, label: b.title, detail: `${displayHost(b.url)} - ${b.workspaceName} / ${b.groupName}`,
      icon: <NamedIcon name={b.icon} size={16} />, badge: <EnvBadge env={b.environment} compact />,
      run: () => { closeDialog(); openBookmark(b, actions.recordOpen); },
    });
    if (!term) {
      const recent = dashboard.recent.map((id) => all.find((b) => b.id === id)).filter((b): b is (typeof all)[number] => !!b).slice(0, 5);
      const pinned = all.filter((b) => b.favorite).slice(0, 5);
      return [...recent.map(toItem), ...pinned.filter((p) => !recent.some((r) => r.id === p.id)).map(toItem), ...commands, ...wsItems];
    }
    const hits = all.filter((b) => bookmarkMatches(b, { ...EMPTY_FILTERS, query: q })).slice(0, 8).map(toItem);
    return [
      ...hits,
      ...wsItems.filter((w) => w.label.toLowerCase().includes(term)),
      ...commands.filter((c) => c.label.toLowerCase().includes(term)),
    ];
  }, [dashboard, q, workspace, prefs, actions, closeDialog, openDialog, setPrefs, setFilters]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, listId]);

  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Command palette"
      onCancel={(e) => { e.preventDefault(); closeDialog(); }}
      onMouseDown={(e) => { if (e.target === ref.current) closeDialog(); }}
    >
      <div className="palette-panel">
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items.length ? `${listId}-${active}` : undefined}
            aria-label="Search bookmarks, workspaces and actions"
            placeholder="Search bookmarks across all workspaces, or type an action..."
            value={q}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); items[active]?.run(); }
            }}
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="palette-list">
          {items.map((it, i) => (
            <li key={it.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseMove={() => setActive(i)} onClick={() => it.run()}>
              <span className="p-icon">{it.icon}</span>
              <span className="p-text"><span className="p-label">{it.label}</span>{it.detail && <span className="p-detail">{it.detail}</span>}</span>
              {it.badge}
              {i === active && <CornerDownLeft size={14} aria-hidden="true" className="p-enter" />}
            </li>
          ))}
          {items.length === 0 && <li className="p-none" role="presentation">Nothing matches "{q}".</li>}
        </ul>
        <div className="palette-foot" aria-hidden="true"><kbd className="kbd">Up</kbd><kbd className="kbd">Down</kbd> navigate <kbd className="kbd">Enter</kbd> open / run <kbd className="kbd">Esc</kbd> close</div>
      </div>
    </dialog>
  );
}
