import { useEffect, useRef } from 'react';
import { DashboardView, moveFocus } from './components/Dashboard';
import { DialogHost } from './components/Dialogs';
import { HomeView } from './components/Home';
import { Palette } from './components/Palette';
import { SettingsView } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Toasts } from './components/ui';
import { Welcome } from './components/Welcome';
import { Link, navigate, workspacePath } from './router';
import { useStore } from './store';

export function App() {
  const { dashboard, loadError, prefs, view, workspace, workspaceMissing, openDialog, dialog, reload } = useStore();
  const mainRef = useRef<HTMLElement>(null);
  const lastView = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openDialog({ type: 'palette' });
        return;
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !dialog) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        e.preventDefault();
        if (view !== 'dashboard' && workspace) navigate(workspacePath(workspace.id));
        else if (view !== 'dashboard') return;
        window.setTimeout(() => document.getElementById('global-search')?.focus(), 50);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDialog, dialog, view, workspace]);

  // After in-app navigation, move focus to the page content (screen readers) and reset the scroll position.
  const routeKey = `${view}:${workspace?.id ?? ''}`;
  useEffect(() => {
    if (lastView.current !== null && lastView.current !== routeKey) {
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    lastView.current = routeKey;
  }, [routeKey]);

  if (loadError && !dashboard) {
    return (
      <main className="fatal" id="main">
        <h1>OpsDesk cannot load</h1>
        <p role="alert">{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => void reload().catch(() => undefined)}>Try again</button>
      </main>
    );
  }
  if (!dashboard) return <main className="fatal" id="main"><p role="status">Loading...</p></main>;

  if (dashboard.setup === 'pending' && view !== 'settings') {
    return (
      <>
        <Welcome />
        <Toasts />
      </>
    );
  }

  return (
    <div className="app" data-density={prefs.density}>
      <a className="skip" href="#main">Skip to content</a>
      <Sidebar />
      <div className="content">
        {view === 'dashboard' && !workspaceMissing && <Topbar />}
        {loadError && <p className="banner" role="alert">Connection problem: {loadError}</p>}
        <main id="main" ref={mainRef} tabIndex={-1} onKeyDown={moveFocus}>
          {view === 'home' && <HomeView />}
          {view === 'settings' && <SettingsView />}
          {view === 'dashboard' && !workspaceMissing && <DashboardView />}
          {view === 'dashboard' && workspaceMissing && (
            <div className="empty">
              <h2>Workspace not found</h2>
              <p>This workspace does not exist (it may have been deleted).</p>
              <Link to="/" className="btn btn-primary">Go to workspace selection</Link>
            </div>
          )}
        </main>
      </div>
      <DialogHost />
      {dialog?.type === 'palette' && <Palette />}
      <Toasts />
    </div>
  );
}
