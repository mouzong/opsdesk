import { FileUp, Sparkles, SquareDashed } from 'lucide-react';
import { useState } from 'react';
import { navigate } from '../router';
import { useStore } from '../store';
import { APP_NAME } from '../../../shared/constants';
import { Logo } from './Sidebar';

export function Welcome() {
  const { actions, run, session } = useStore();
  const [busy, setBusy] = useState(false);
  const choose = async (choice: 'sample' | 'empty') => {
    setBusy(true);
    await run(() => actions.completeSetup(choice));
    setBusy(false);
  };
  return (
    <main className="welcome" id="main">
      <Logo />
      <h1>Welcome to OpsDesk</h1>
      <p className="lead">A local, offline dashboard for the URLs and tools you use every day. Everything is stored on this computer.</p>
      <div className="choices">
        <button type="button" className="choice-card" disabled={busy} onClick={() => choose('sample')}>
          <Sparkles size={22} aria-hidden="true" />
          <strong>Start with sample data</strong>
          <span>Five workspaces with clearly labelled placeholder bookmarks (Kibana, Grafana, GitLab, runbooks...) on reserved example domains. Remove them any time in Settings.</span>
        </button>
        <button type="button" className="choice-card" disabled={busy} onClick={() => choose('empty')}>
          <SquareDashed size={22} aria-hidden="true" />
          <strong>Start with an empty dashboard</strong>
          <span>Create your own workspaces, groups and bookmarks, or import them from a file.</span>
        </button>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => navigate('/settings')}>
        <FileUp size={14} aria-hidden="true" /> I already have an export or backup - open import
      </button>
      {session && <p className="app-version">{APP_NAME} · v{session.version}</p>}
    </main>
  );
}
