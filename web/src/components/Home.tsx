import { EllipsisVertical, Plus } from 'lucide-react';
import { countBookmarks } from '../../../shared/search';
import { NamedIcon } from '../icons';
import { Link, workspacePath } from '../router';
import { useStore } from '../store';
import { plural } from '../util';
import { Menu } from './ui';
import { useWorkspaceMenu } from './workspaceMenu';

/** Workspace selection: the screen the logo / product name leads to. Visiting it changes nothing. */
export function HomeView() {
  const { dashboard, prefs, openDialog } = useStore();
  const workspaceMenu = useWorkspaceMenu();
  if (!dashboard) return null;
  const list = dashboard.workspaces;

  return (
    <div className="home">
      <header className="home-head">
        <h1>Choose a workspace</h1>
        <p className="muted">
          {list.length === 0
            ? 'Workspaces separate areas such as Daily Operations, Observability or Infrastructure.'
            : `${plural(list.length, 'workspace')}. Press Ctrl/Cmd+K to jump straight to any bookmark.`}
        </p>
      </header>
      {list.length === 0 && (
        <div className="empty">
          <h2>No workspaces yet</h2>
          <p>Create your first workspace to start adding groups and bookmarks.</p>
        </div>
      )}
      <ul className="ws-grid" aria-label="Workspaces">
        {list.map((w, i, all) => {
          const groups = w.groups.length;
          const bookmarks = countBookmarks([w]);
          const pinned = w.groups.reduce((n, g) => n + g.bookmarks.filter((b) => b.favorite).length, 0);
          return (
            <li key={w.id} className="ws-card-wrap">
              <Link to={workspacePath(w.id)} className="ws-card" aria-label={`Open workspace ${w.name}`}>
                <span className="ws-card-icon" aria-hidden="true"><NamedIcon name={w.icon} size={22} /></span>
                <span className="ws-card-name">{w.name}</span>
                <span className="ws-card-meta">{plural(groups, 'group')} · {plural(bookmarks, 'bookmark')}{pinned > 0 ? ` · ${pinned} pinned` : ''}</span>
                {prefs.workspaceId === w.id && <span className="ws-card-last">Last opened</span>}
              </Link>
              <Menu
                className="icon-btn ws-card-menu"
                label={`Actions for workspace ${w.name}`}
                trigger={<EllipsisVertical size={16} aria-hidden="true" />}
                items={workspaceMenu(w, i, all)}
              />
            </li>
          );
        })}
        <li className="ws-card-wrap">
          <button type="button" className="ws-card ws-card-new" onClick={() => openDialog({ type: 'name', kind: 'workspace-create' })}>
            <span className="ws-card-icon" aria-hidden="true"><Plus size={22} /></span>
            <span className="ws-card-name">New workspace</span>
            <span className="ws-card-meta">Create a workspace and open it</span>
          </button>
        </li>
      </ul>
    </div>
  );
}
