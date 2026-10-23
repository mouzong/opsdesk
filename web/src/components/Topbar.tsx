import { Command, LayoutGrid, Monitor, Moon, Plus, Rows3, Search, Star, Sun, X } from 'lucide-react';
import { useMemo } from 'react';
import { ENVIRONMENTS, ENVIRONMENT_LABELS } from '../../../shared/constants';
import { collectTags, hasActiveFilters, hasActiveCriteria } from '../../../shared/search';
import { useStore, type Theme } from '../store';
import { plural } from '../util';
import { EnvBadge, Menu, Popover } from './ui';

export function Topbar() {
  const { dashboard, workspace, filters, setFilters, openDialog, prefs, setPrefs } = useStore();
  const scopeWs = useMemo(
    () => (dashboard ? dashboard.workspaces.filter((w) => filters.scope === 'all' || w.id === workspace?.id) : []),
    [dashboard, filters.scope, workspace],
  );
  const placeholder = filters.scope === 'all' ? 'Search all workspaces...' : `Search in ${workspace?.name ?? 'this workspace'}...`;
  const themeIcon = prefs.theme === 'dark' ? <Moon size={18} aria-hidden="true" /> : prefs.theme === 'light' ? <Sun size={18} aria-hidden="true" /> : <Monitor size={18} aria-hidden="true" />;
  const setTheme = (t: Theme) => setPrefs({ theme: t });

  return (
    <header className="topbar">
      <div className="search-wrap" role="search">
        <Search size={18} className="search-icon" aria-hidden="true" />
        <input
          id="global-search"
          type="search"
          className="search"
          value={filters.query}
          placeholder={placeholder}
          aria-label={`Search bookmarks (${filters.scope === 'all' ? 'all workspaces' : 'current workspace'})`}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setFilters({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filters.query) { e.preventDefault(); setFilters({ query: '' }); }
          }}
        />
        {filters.query ? (
          <button type="button" className="icon-btn search-clear" aria-label="Clear search" onClick={() => { setFilters({ query: '' }); document.getElementById('global-search')?.focus(); }}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : (
          <kbd className="kbd" aria-hidden="true">/</kbd>
        )}
      </div>

      <div className="segmented" role="group" aria-label="Search scope">
        <button type="button" aria-pressed={filters.scope === 'workspace'} onClick={() => setFilters({ scope: 'workspace' })}>This workspace</button>
        <button type="button" aria-pressed={filters.scope === 'all'} onClick={() => setFilters({ scope: 'all' })}>All workspaces</button>
      </div>

      <button type="button" className="btn btn-primary" onClick={() => openDialog({ type: 'bookmark', mode: 'create' })} disabled={!dashboard || dashboard.workspaces.length === 0}>
        <Plus size={16} aria-hidden="true" /> <span>Add bookmark</span>
      </button>

      <div className="topbar-tools">
        <button type="button" className="btn btn-ghost" onClick={() => openDialog({ type: 'palette' })} aria-label="Open command palette" title="Command palette (Ctrl/Cmd+K)">
          <Command size={16} aria-hidden="true" /> <span className="hide-sm">K</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={prefs.density === 'compact' ? 'Switch to comfortable layout' : 'Switch to compact layout'}
          title={prefs.density === 'compact' ? 'Comfortable layout' : 'Compact layout'}
          onClick={() => setPrefs({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' })}
        >
          {prefs.density === 'compact' ? <LayoutGrid size={18} aria-hidden="true" /> : <Rows3 size={18} aria-hidden="true" />}
        </button>
        <Menu
          label={`Theme: ${prefs.theme}`}
          trigger={themeIcon}
          items={[
            { label: 'Dark', icon: <Moon size={16} />, onSelect: () => setTheme('dark') },
            { label: 'Light', icon: <Sun size={16} />, onSelect: () => setTheme('light') },
            { label: 'System', icon: <Monitor size={16} />, onSelect: () => setTheme('system') },
          ]}
        />
      </div>
      <FilterBar scopeWs={scopeWs} />
    </header>
  );
}

function FilterBar({ scopeWs }: { scopeWs: NonNullable<ReturnType<typeof useStore>['dashboard']>['workspaces'] }) {
  const { filters, setFilters, clearFilters, dashboard } = useStore();
  const envCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of scopeWs) for (const g of w.groups) for (const b of g.bookmarks) m.set(b.environment, (m.get(b.environment) ?? 0) + 1);
    return m;
  }, [scopeWs]);
  const tags = useMemo(() => collectTags(scopeWs), [scopeWs]);
  const filtersOn = hasActiveFilters(filters);
  const any = hasActiveCriteria(filters);
  if (!dashboard || dashboard.workspaces.length === 0) return null;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="filters" role="group" aria-label="Filters">
      <Popover
        label="Filter by environment"
        active={filters.environments.length > 0}
        trigger={<>Environment{filters.environments.length > 0 && <span className="pill">{filters.environments.length}</span>}</>}
      >
        <fieldset className="checklist">
          <legend className="sr-only">Environments</legend>
          {ENVIRONMENTS.map((e) => (
            <label key={e} className="check">
              <input type="checkbox" checked={filters.environments.includes(e)} onChange={() => setFilters({ environments: toggle(filters.environments, e) })} />
              <EnvBadge env={e} />
              <span className="muted">{envCounts.get(e) ?? 0}</span>
            </label>
          ))}
        </fieldset>
      </Popover>

      <Popover
        label="Filter by tag"
        active={filters.tags.length > 0}
        trigger={<>Tags{filters.tags.length > 0 && <span className="pill">{filters.tags.length}</span>}</>}
      >
        {tags.length === 0 ? (
          <p className="muted pad">No tags yet. Add tags when editing a bookmark.</p>
        ) : (
          <fieldset className="checklist">
            <legend className="legend">Bookmarks must have all selected tags</legend>
            {tags.map((t) => (
              <label key={t.tag} className="check">
                <input type="checkbox" checked={filters.tags.some((x) => x.toLowerCase() === t.tag.toLowerCase())} onChange={() => setFilters({ tags: filters.tags.some((x) => x.toLowerCase() === t.tag.toLowerCase()) ? filters.tags.filter((x) => x.toLowerCase() !== t.tag.toLowerCase()) : [...filters.tags, t.tag] })} />
                <span className="tag">{t.tag}</span>
                <span className="muted">{t.count}</span>
              </label>
            ))}
          </fieldset>
        )}
      </Popover>

      <button type="button" className={`btn btn-ghost chip-btn${filters.favoritesOnly ? ' is-active' : ''}`} aria-pressed={filters.favoritesOnly} onClick={() => setFilters({ favoritesOnly: !filters.favoritesOnly })}>
        <Star size={14} aria-hidden="true" fill={filters.favoritesOnly ? 'currentColor' : 'none'} /> Favorites
      </button>

      {filters.environments.map((e) => (
        <button key={e} type="button" className="applied" onClick={() => setFilters({ environments: filters.environments.filter((x) => x !== e) })} aria-label={`Remove filter ${ENVIRONMENT_LABELS[e]}`}>
          {ENVIRONMENT_LABELS[e]} <X size={12} aria-hidden="true" />
        </button>
      ))}
      {filters.tags.map((t) => (
        <button key={t} type="button" className="applied" onClick={() => setFilters({ tags: filters.tags.filter((x) => x !== t) })} aria-label={`Remove filter tag ${t}`}>
          #{t} <X size={12} aria-hidden="true" />
        </button>
      ))}

      <div className="spacer" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters} disabled={!filtersOn}>Clear filters</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ query: '' })} disabled={!filters.query}>Reset search</button>
      {any && <span className="sr-only" role="status">{plural([filters.environments.length, filters.tags.length, filters.favoritesOnly ? 1 : 0, filters.query ? 1 : 0].reduce((a, b) => a + b, 0), 'criterion', 'criteria')} active</span>}
    </div>
  );
}
