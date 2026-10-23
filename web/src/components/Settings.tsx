import { BookOpen, Download, FileUp, HardDrive, Info, Pencil, RotateCcw, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { APP_NAME } from '../../../shared/constants';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { BackupInfo, ImportPreview } from '../../../shared/types';
import { api, ApiError } from '../api';
import { navigate } from '../router';
import { useStore, type Density, type Theme } from '../store';
import { formatBytes, formatDate, plural } from '../util';
import { ConfirmModal } from './ui';

export function SettingsView() {
  const { dashboard, session, prefs, setPrefs, openDialog, actions, run } = useStore();
  const [confirmSample, setConfirmSample] = useState(false);
  const external = !!session && session.database.client !== 'sqlite';
  const sampleCount = dashboard ? dashboard.workspaces.reduce((n, w) => n + w.groups.reduce((m, g) => m + g.bookmarks.filter((b) => b.isSample).length, 0), 0) : 0;
  const hasSample = dashboard?.workspaces.some((w) => w.isSample || w.groups.some((g) => g.isSample || g.bookmarks.some((b) => b.isSample))) ?? false;

  return (
    <div className="settings">
      <h2 className="page-title">Settings</h2>

      <section className="panel-card" aria-labelledby="s-general">
        <h3 id="s-general">General</h3>
        <div className="setting-row">
          <div>
            <strong>Dashboard title</strong>
            <p className="muted">{dashboard?.title}</p>
          </div>
          <button type="button" className="btn" onClick={() => openDialog({ type: 'name', kind: 'title' })}><Pencil size={14} aria-hidden="true" /> Edit</button>
        </div>
        <fieldset className="setting-row stack">
          <legend><strong>Theme</strong></legend>
          <div className="segmented" role="group" aria-label="Theme">
            {(['dark', 'light', 'system'] as Theme[]).map((t) => (
              <button key={t} type="button" aria-pressed={prefs.theme === t} onClick={() => setPrefs({ theme: t })}>{t[0]!.toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="setting-row stack">
          <legend><strong>Card layout</strong></legend>
          <div className="segmented" role="group" aria-label="Card layout">
            {(['comfortable', 'compact'] as Density[]).map((d) => (
              <button key={d} type="button" aria-pressed={prefs.density === d} onClick={() => setPrefs({ density: d })}>{d[0]!.toUpperCase() + d.slice(1)}</button>
            ))}
          </div>
          <p className="muted">Theme, layout and sidebar state are stored in this browser only; bookmarks live in the local database.</p>
        </fieldset>
      </section>

      <section className="callout warn" aria-labelledby="s-secrets">
        <ShieldAlert size={20} aria-hidden="true" />
        <div>
          <h3 id="s-secrets">Keep secrets out of bookmarks</h3>
          <p>Bookmark URLs, descriptions and notes are stored unencrypted and included in exports and backups. Do not put passwords, API keys, tokens or session identifiers in them (including in URL query strings).</p>
        </div>
      </section>

      <section className="panel-card" aria-labelledby="s-data">
        <h3 id="s-data"><HardDrive size={16} aria-hidden="true" /> Data location</h3>
        <dl className="details">
          <dt>Database engine</dt>
          <dd data-testid="db-engine">
            <span className="db-engine"><span className="db-badge">{session?.database.label}</span><span className="muted">read-only - chosen when OpsDesk starts{session?.database.tls === null || session?.database.tls === undefined ? '' : session.database.tls ? ', TLS on' : ', TLS off'}</span></span>
          </dd>
          <dt>Data directory</dt><dd className="mono wrap" data-testid="data-dir">{session?.dataDir}</dd>
          {external ? (
            <><dt>Database server</dt><dd className="muted">Configured on the server (OPSDESK_DATABASE_URL); connection details are never shown or sent to the browser.</dd>
            <dt>Safety exports folder</dt><dd className="mono wrap">{session?.backupDir}</dd></>
          ) : (
            <><dt>Database file</dt><dd className="mono wrap">{session?.dbPath}</dd>
            <dt>Backups folder</dt><dd className="mono wrap">{session?.backupDir}</dd></>
          )}
          <dt>Listening on</dt><dd className="mono">{session ? `${session.host}:${session.port}` : ''}</dd>
          <dt>Schema version</dt><dd>{session?.schemaVersion}</dd>
        </dl>
        <p className="muted">The engine and location are deployment settings (<code>OPSDESK_DB_CLIENT</code>, <code>OPSDESK_DATA_DIR</code>, ...): change them in the configuration and restart. Switching engine does not move data - use Export JSON, then Import (see the README).</p>
      </section>

      <BackupsPanel />
      <ImportPanel />

      <section className="panel-card" aria-labelledby="s-sample">
        <h3 id="s-sample">Sample data</h3>
        {hasSample ? (
          <>
            <p>Your dashboard still contains sample content ({plural(sampleCount, 'bookmark')}, marked "Sample"). Removing it deletes only untouched sample items - anything you edited or added is kept. Sample data is never added again.</p>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmSample(true)}><Trash2 size={14} aria-hidden="true" /> Remove sample data</button>
          </>
        ) : (
          <p className="muted">No sample content in the dashboard. It will not be added again.</p>
        )}
        {confirmSample && (
          <ConfirmModal
            title="Remove sample data?"
            danger
            confirmLabel="Remove sample data"
            message={<p>All untouched sample workspaces, groups and bookmarks will be deleted. Your own content is not affected.</p>}
            onClose={() => setConfirmSample(false)}
            onConfirm={async () => {
              setConfirmSample(false);
              const r = await run(() => actions.removeSample());
              if (r) await run(async () => undefined, `Removed ${plural(r.bookmarks, 'bookmark')}, ${plural(r.groups, 'group')} and ${plural(r.workspaces, 'workspace')}.`);
            }}
          />
        )}
      </section>

      <section className="panel-card" aria-labelledby="s-about">
        <h3 id="s-about"><Info size={16} aria-hidden="true" /> About</h3>
        <dl className="details" data-testid="about">
          <dt>Application</dt><dd>{APP_NAME}</dd>
          <dt>Release version</dt><dd data-testid="about-version">{session ? `v${session.version}` : ''}</dd>
          {session?.build && (
            <>
              <dt>Built</dt><dd data-testid="about-built">{formatDate(session.build.builtAt)}</dd>
              {session.build.commit && (<><dt>Commit</dt><dd className="mono" data-testid="about-commit">{session.build.commit}</dd></>)}
            </>
          )}
        </dl>
        {!session?.build && <p className="muted">Build date and commit are recorded by <code>npm run build</code> and are not available when running the development server.</p>}
        <div className="row wrap-row">
          <a className="btn" href="/docs/" target="_blank" rel="noopener"><BookOpen size={14} aria-hidden="true" /> Open the documentation</a>
          <a className="btn" href="/docs/api/reference/" target="_blank" rel="noopener">API reference (Swagger)</a>
        </div>
      </section>

      <section className="panel-card" aria-labelledby="s-net">
        <h3 id="s-net">Privacy and network</h3>
        <ul className="plain">
          <li>OpsDesk runs entirely on this machine and never contacts the internet or the bookmarked services.</li>
          <li>It has no login. It listens on the loopback address only; do not expose it to a network without adding authentication and TLS in front of it.</li>
          <li>Bookmarks show "initials" or bundled icons - favicons are never downloaded.</li>
          <li>Having a bookmark does not mean a service is healthy: OpsDesk performs no status checks.</li>
        </ul>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- backups */

function BackupsPanel() {
  const { reload, run, toast, session } = useStore();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [restore, setRestore] = useState<BackupInfo | null>(null);
  const [remove, setRemove] = useState<BackupInfo | null>(null);

  const refresh = useCallback(async () => {
    if (session && session.database.client !== 'sqlite') return;
    try {
      // GET /backups is paginated (limit max 200): the UI shows the newest 200
      setList((await api<{ items: BackupInfo[] }>('GET', '/backups?limit=200')).items);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Could not list backups.');
    }
  }, [toast, session]);
  useEffect(() => { void refresh(); }, [refresh]);

  if (session && session.database.client !== 'sqlite') {
    return (
      <section className="panel-card" aria-labelledby="s-backup">
        <h3 id="s-backup">Export and backups</h3>
        <div className="row wrap-row">
          <a className="btn btn-primary" href="/api/export" download><Download size={14} aria-hidden="true" /> Export JSON</a>
        </div>
        <p>Database backups for {session.database.label} are made with your database tooling ({session.database.client === 'postgres' ? 'pg_dump / pg_restore' : 'mysqldump / mysql'}), not by OpsDesk. See the documentation (Operations, Backup and restore).</p>
        <p className="muted">The JSON export is the portable copy: all workspaces, groups, bookmarks and their order, and the dashboard title. Before every import OpsDesk also writes a <code>pre-import-*.json</code> safety export to the safety exports folder above; restore it with Import &gt; Replace.</p>
      </section>
    );
  }

  const kindLabel: Record<BackupInfo['kind'], string> = { manual: 'Manual', auto: 'Automatic', 'pre-import': 'Before import', 'pre-restore': 'Before restore', other: 'Other' };

  return (
    <section className="panel-card" aria-labelledby="s-backup">
      <h3 id="s-backup">Export and backups</h3>
      <div className="row wrap-row">
        <a className="btn" href="/api/export" download><Download size={14} aria-hidden="true" /> Export JSON</a>
        <button type="button" className="btn btn-primary" onClick={() => void run(async () => { await api('POST', '/backups', {}); await refresh(); }, 'Backup created.')}>
          <HardDrive size={14} aria-hidden="true" /> Create backup now
        </button>
      </div>
      <p className="muted">The JSON export contains all workspaces, groups, bookmarks and their order - it is the portable format. Database backups are consistent SQLite snapshots stored in the backups folder; an automatic one is made at start-up when the newest is older than 24 hours.</p>
      {list === null ? <p className="muted">Loading backups...</p> : list.length === 0 ? <p className="muted">No backups yet.</p> : (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Database backups</caption>
            <thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Created</th><th scope="col">Size</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.name}>
                  <td className="mono wrap">{b.name}</td><td>{kindLabel[b.kind]}</td><td>{formatDate(b.createdAt)}</td><td>{formatBytes(b.sizeBytes)}</td>
                  <td className="actions">
                    <a className="btn btn-sm" href={`/api/backups/${encodeURIComponent(b.name)}/download`} download aria-label={`Download ${b.name}`}><Download size={14} aria-hidden="true" /></a>
                    <button type="button" className="btn btn-sm" onClick={() => setRestore(b)} aria-label={`Restore ${b.name}`}><RotateCcw size={14} aria-hidden="true" /> Restore</button>
                    <button type="button" className="btn btn-sm btn-danger-ghost" onClick={() => setRemove(b)} aria-label={`Delete ${b.name}`}><Trash2 size={14} aria-hidden="true" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {restore && (
        <ConfirmModal
          title="Restore this backup?"
          danger
          confirmLabel="Restore backup"
          message={<><p>The current dashboard will be replaced by <strong className="mono">{restore.name}</strong>.</p><p>A safety backup of the current data ("Before restore") is created first, so you can undo this.</p></>}
          onClose={() => setRestore(null)}
          onConfirm={async () => {
            const b = restore;
            setRestore(null);
            await run(async () => { await api('POST', `/backups/${encodeURIComponent(b.name)}/restore`, { confirm: true }); await reload(); await refresh(); }, 'Backup restored.');
          }}
        />
      )}
      {remove && (
        <ConfirmModal
          title="Delete this backup file?"
          danger
          confirmLabel="Delete backup"
          message={<p><span className="mono">{remove.name}</span> will be permanently deleted.</p>}
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            const b = remove;
            setRemove(null);
            await run(async () => { await api('DELETE', `/backups/${encodeURIComponent(b.name)}`, {}); await refresh(); }, 'Backup deleted.');
          }}
        />
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- import */

type Payload = { source: 'json'; data: unknown } | { source: 'html'; html: string };

function ImportPanel() {
  const { reload, toast } = useStore();
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [duplicates, setDuplicates] = useState<'skip' | 'update'>('skip');
  const [wsName, setWsName] = useState('Imported bookmarks');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const body = useCallback(
    () => (payload ? (payload.source === 'json' ? { ...payload, mode, duplicates } : { ...payload, workspaceName: wsName, duplicates }) : null),
    [payload, mode, duplicates, wsName],
  );

  useEffect(() => {
    const b = body();
    setPreview(null);
    setConfirmReplace(false);
    if (!b) return;
    let stale = false;
    const t = window.setTimeout(async () => {
      try {
        const p = await api<ImportPreview>('POST', '/import/preview', b);
        if (!stale) { setPreview(p); setError(''); }
      } catch (e) {
        if (!stale) setError(e instanceof ApiError ? e.message : 'Preview failed.');
      }
    }, 250);
    return () => { stale = true; window.clearTimeout(t); };
  }, [body]);

  async function onFile(file: File | undefined) {
    setError('');
    setPreview(null);
    setPayload(null);
    if (!file) return;
    setFileName(file.name);
    if (file.size > LIMITS.importBytes) return setError(`This file is larger than the ${LIMITS.importBytes / 1024 / 1024} MB limit.`);
    const text = await file.text();
    const looksJson = /\.json$/i.test(file.name) || text.trimStart().startsWith('{');
    if (looksJson) {
      try {
        setPayload({ source: 'json', data: JSON.parse(text) });
      } catch {
        setError('This file is not valid JSON.');
      }
    } else if (/\.html?$/i.test(file.name) || /<dt>|<a\s/i.test(text)) {
      setPayload({ source: 'html', html: text });
      setMode('merge');
    } else setError('Unsupported file. Choose an OpsDesk JSON export or a browser bookmarks HTML file.');
  }

  async function apply() {
    const b = body();
    if (!b) return;
    setBusy(true);
    try {
      const r = await api<{ preview: ImportPreview; backup: string }>('POST', '/import/apply', { ...b, confirmReplace });
      await reload();
      toast('success', `Import complete. Safety backup: ${r.backup}`);
      setPayload(null); setPreview(null); setFileName(''); setConfirmReplace(false);
      if (fileRef.current) fileRef.current.value = '';
      navigate('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const c = preview?.counts;
  const isHtml = payload?.source === 'html';
  return (
    <section className="panel-card" aria-labelledby="s-import">
      <h3 id="s-import"><FileUp size={16} aria-hidden="true" /> Import</h3>
      <p className="muted">Import an OpsDesk JSON export, or a bookmarks file exported from Chrome, Edge, Firefox or Safari (HTML). Files are parsed as data and never rendered. Nothing changes until you confirm.</p>
      <div className="form-grid">
        <div className="full field">
          <label htmlFor={`${uid}-file`}>File (.json or .html, max {LIMITS.importBytes / 1024 / 1024} MB)</label>
          <input ref={fileRef} id={`${uid}-file`} type="file" accept=".json,.html,.htm,application/json,text/html" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {payload && !isHtml && (
          <>
            <fieldset className="choice">
              <legend>Mode</legend>
              <label className="radio"><input type="radio" name={`${uid}-mode`} checked={mode === 'merge'} onChange={() => setMode('merge')} /><span><strong>Merge</strong> - add to the existing dashboard</span></label>
              <label className="radio danger-text"><input type="radio" name={`${uid}-mode`} checked={mode === 'replace'} onChange={() => setMode('replace')} /><span><strong>Replace</strong> - delete everything first</span></label>
            </fieldset>
            <fieldset className="choice" disabled={mode === 'replace'}>
              <legend>When a bookmark already exists</legend>
              <label className="radio"><input type="radio" name={`${uid}-dup`} checked={duplicates === 'skip'} onChange={() => setDuplicates('skip')} /><span>Keep the existing one (skip)</span></label>
              <label className="radio"><input type="radio" name={`${uid}-dup`} checked={duplicates === 'update'} onChange={() => setDuplicates('update')} /><span>Update it from the file</span></label>
            </fieldset>
          </>
        )}
        {isHtml && (
          <>
            <div className="field">
              <label htmlFor={`${uid}-ws`}>Import into workspace</label>
              <input id={`${uid}-ws`} value={wsName} maxLength={LIMITS.name} onChange={(e) => setWsName(e.target.value)} />
              <p className="field-hint">Created if it does not exist. Browser folders become groups.</p>
            </div>
            <fieldset className="choice">
              <legend>When a bookmark already exists</legend>
              <label className="radio"><input type="radio" name={`${uid}-dup`} checked={duplicates === 'skip'} onChange={() => setDuplicates('skip')} /><span>Keep the existing one (skip)</span></label>
              <label className="radio"><input type="radio" name={`${uid}-dup`} checked={duplicates === 'update'} onChange={() => setDuplicates('update')} /><span>Update it from the file</span></label>
            </fieldset>
          </>
        )}
      </div>
      <p className="field-hint">Duplicates: workspaces and groups match by name, bookmarks by URL within the same group (case-insensitive names, normalised URLs).</p>

      {error && <p className="form-error" role="alert">{error}</p>}

      {preview && c && (
        <div className="preview" aria-live="polite">
          <h4>Preview of "{fileName}" - {preview.mode === 'replace' ? 'replace all data' : 'merge'}</h4>
          <ul className="plain">
            <li><strong>{c.workspacesAdded}</strong> new workspace(s), {c.workspacesExisting} existing</li>
            <li><strong>{c.groupsAdded}</strong> new group(s), {c.groupsExisting} existing</li>
            <li><strong>{c.bookmarksAdded}</strong> bookmark(s) added, <strong>{c.bookmarksUpdated}</strong> updated, <strong>{c.bookmarksSkipped}</strong> duplicate(s) skipped</li>
            {preview.mode === 'replace' && <li className="danger-text"><strong>Will delete:</strong> {c.workspacesRemoved} workspace(s), {c.groupsRemoved} group(s), {c.bookmarksRemoved} bookmark(s)</li>}
            {preview.titleChange && <li>Dashboard title changes from "{preview.titleChange.from}" to "{preview.titleChange.to}"</li>}
          </ul>
          {preview.warnings.map((w) => <p key={w} className="form-warn">{w}</p>)}
          {preview.sample.length > 0 && <pre className="sample-lines" aria-label="Sample of changes">{preview.sample.join('\n')}</pre>}
          {preview.mode === 'replace' && (
            <label className="check">
              <input type="checkbox" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
              <span>I understand this replaces my current dashboard. A backup is created automatically first.</span>
            </label>
          )}
          <button type="button" className={`btn ${preview.mode === 'replace' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (preview.mode === 'replace' && !confirmReplace)} onClick={apply}>
            <Upload size={14} aria-hidden="true" /> {preview.mode === 'replace' ? 'Replace dashboard' : 'Import'}
          </button>
        </div>
      )}
    </section>
  );
}
