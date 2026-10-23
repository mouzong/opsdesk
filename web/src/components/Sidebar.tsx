import { BookOpen, EllipsisVertical, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings } from 'lucide-react';
import { APP_NAME } from '../../../shared/constants';
import { NamedIcon } from '../icons';
import { Link, workspacePath } from '../router';
import { useStore } from '../store';
import { Menu } from './ui';
import { useWorkspaceMenu } from './workspaceMenu';

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <g fill="#fff">
        <rect x="7" y="7" width="8" height="8" rx="2" />
        <rect x="17" y="7" width="8" height="8" rx="2" opacity=".65" />
        <rect x="7" y="17" width="8" height="8" rx="2" opacity=".65" />
        <rect x="17" y="17" width="8" height="8" rx="2" />
      </g>
    </svg>
  );
}

export function Sidebar() {
  const { dashboard, prefs, setPrefs, workspace, view, openDialog, clearFilters, setFilters, session } = useStore();
  const workspaceMenu = useWorkspaceMenu();
  const collapsed = prefs.sidebarCollapsed;
  const count = (wsId: string) => dashboard?.workspaces.find((w) => w.id === wsId)?.groups.reduce((n, g) => n + g.bookmarks.length, 0) ?? 0;

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Sidebar">
      <div className="brand">
        {/* Logo and product name: one link back to the workspace-selection screen (client-side, no reload). */}
        <Link to="/" className="brand-link" aria-label="Go to workspace selection" title="Go to workspace selection" aria-current={view === 'home' ? 'page' : undefined}>
          <Logo />
          {!collapsed && <span className="brand-title">{dashboard?.title ?? 'OpsDesk'}</span>}
        </Link>
        {!collapsed && (
          <button type="button" className="icon-btn" aria-label="Edit dashboard title" title="Edit dashboard title" onClick={() => openDialog({ type: 'name', kind: 'title' })}>
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      <nav aria-label="Workspaces" className="ws-nav">
        {!collapsed && <h2 className="nav-label">Workspaces</h2>}
        <ul>
          {dashboard?.workspaces.map((w, i, all) => {
            const current = view === 'dashboard' && workspace?.id === w.id;
            return (
              <li key={w.id} className={`ws-row${current ? ' current' : ''}`}>
                <Link
                  to={workspacePath(w.id)}
                  className="ws-item"
                  aria-current={current ? 'page' : undefined}
                  title={collapsed ? `${w.name} (${count(w.id)})` : undefined}
                  onClick={() => setPrefs({ workspaceId: w.id })}
                >
                  <NamedIcon name={w.icon} size={18} />
                  {!collapsed && <span className="ws-name">{w.name}</span>}
                  {!collapsed && <span className="count">{count(w.id)}</span>}
                  {collapsed && <span className="sr-only">{w.name}</span>}
                </Link>
                {!collapsed && (
                  <Menu
                    className="icon-btn ws-menu"
                    label={`Actions for workspace ${w.name}`}
                    trigger={<EllipsisVertical size={16} aria-hidden="true" />}
                    items={workspaceMenu(w, i, all)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <button type="button" className="ws-item add" onClick={() => openDialog({ type: 'name', kind: 'workspace-create' })} title="New workspace">
          <Plus size={18} aria-hidden="true" />
          {collapsed ? <span className="sr-only">New workspace</span> : <span className="ws-name">New workspace</span>}
        </button>
      </nav>

      <nav aria-label="Application" className="app-nav">
        <Link
          to="/settings"
          className={`ws-item${view === 'settings' ? ' current' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          title="Settings"
          onClick={() => { clearFilters(); setFilters({ query: '' }); }}
        >
          <Settings size={18} aria-hidden="true" />
          {collapsed ? <span className="sr-only">Settings</span> : <span className="ws-name">Settings, data and backups</span>}
        </Link>
        {/* Built documentation, served by the same server under /docs/ (full page load: it is not part of the SPA router). */}
        <a className="ws-item" href="/docs/" target="_blank" rel="noopener" title="Documentation (opens in a new tab)">
          <BookOpen size={18} aria-hidden="true" />
          {collapsed ? <span className="sr-only">Documentation</span> : <span className="ws-name">Documentation</span>}
        </a>
        <button
          type="button"
          className="ws-item"
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setPrefs({ sidebarCollapsed: !collapsed })}
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          {collapsed ? <span className="sr-only">Expand sidebar</span> : <span className="ws-name">Collapse sidebar</span>}
        </button>
      </nav>
      {session && (
        <p className="app-version" title={`${APP_NAME} release ${session.version}`}>
          <span className="ver-name">{APP_NAME} · </span>
          <span>v{session.version}</span>
        </p>
      )}
    </aside>
  );
}
