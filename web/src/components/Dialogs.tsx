import { useId, useMemo, useState, type FormEvent } from 'react';
import { ENVIRONMENTS, ENVIRONMENT_LABELS, ICON_NAMES, LIMITS, type Environment } from '../../../shared/constants';
import { collectTags } from '../../../shared/search';
import type { Bookmark } from '../../../shared/types';
import { checkBookmarkUrl } from '../../../shared/url';
import { ApiError } from '../api';
import { navigate, useRoute, workspacePath } from '../router';
import { NamedIcon } from '../icons';
import { useStore, type DialogState } from '../store';
import { formatDate, plural } from '../util';
import { ConfirmModal, EnvBadge, Field, Modal, useFocusOnMount } from './ui';

export function DialogHost() {
  const { dialog } = useStore();
  if (!dialog) return null;
  switch (dialog.type) {
    case 'bookmark': return <BookmarkDialog d={dialog} />;
    case 'details': return <DetailsDialog id={dialog.bookmarkId} />;
    case 'delete-bookmark': return <DeleteBookmarkDialog id={dialog.bookmarkId} />;
    case 'move-bookmark': return <MoveBookmarkDialog id={dialog.bookmarkId} />;
    case 'name': return <NameDialog d={dialog} />;
    case 'delete-structure': return <DeleteStructureDialog kind={dialog.kind} id={dialog.id} />;
    case 'move-group': return <MoveGroupDialog id={dialog.id} />;
    default: return null;
  }
}

/* --------------------------------------------------------------- bookmark */

function IconPicker({ value, onChange, allowAuto = true, label }: { value: string | null; onChange: (v: string | null) => void; allowAuto?: boolean; label: string }) {
  return (
    <div className="icon-grid" role="group" aria-label={label}>
      {allowAuto && (
        <button type="button" className={`icon-choice auto${value === null ? ' selected' : ''}`} aria-pressed={value === null} onClick={() => onChange(null)} title="Automatic (initials)">
          Aa
        </button>
      )}
      {ICON_NAMES.map((n) => (
        <button key={n} type="button" className={`icon-choice${value === n ? ' selected' : ''}`} aria-pressed={value === n} aria-label={n.replace(/-/g, ' ')} title={n.replace(/-/g, ' ')} onClick={() => onChange(n)}>
          <NamedIcon name={n} size={18} />
        </button>
      ))}
    </div>
  );
}

type BookmarkDialogState = Extract<DialogState, { type: 'bookmark' }>;

function BookmarkDialog({ d }: { d: BookmarkDialogState }) {
  const { dashboard, workspace, closeDialog, actions, findBookmark, toast } = useStore();
  const uid = useId();
  const editing = d.mode === 'edit' ? findBookmark(d.bookmarkId) : null;
  const initialGroup = editing?.group ?? (d.mode === 'create' && d.groupId ? dashboard?.workspaces.flatMap((w) => w.groups).find((g) => g.id === d.groupId) : undefined);
  const initialWs = editing?.workspace ?? dashboard?.workspaces.find((w) => w.id === initialGroup?.workspaceId) ?? workspace ?? dashboard?.workspaces[0];

  const b: Bookmark | undefined = editing?.bookmark;
  const [title, setTitle] = useState(b?.title ?? '');
  const [url, setUrl] = useState(b?.url ?? '');
  const [description, setDescription] = useState(b?.description ?? '');
  const [wsId, setWsId] = useState(initialWs?.id ?? '');
  const [groupId, setGroupId] = useState(initialGroup?.id ?? initialWs?.groups[0]?.id ?? '__new__');
  const [newGroup, setNewGroup] = useState('');
  const [environment, setEnvironment] = useState<Environment>(b?.environment ?? 'other');
  const [owner, setOwner] = useState(b?.owner ?? '');
  const [tagsText, setTagsText] = useState(b?.tags.join(', ') ?? '');
  const [icon, setIcon] = useState<string | null>(b?.icon ?? null);
  const [favorite, setFavorite] = useState(b?.favorite ?? false);
  const [note, setNote] = useState(b?.note ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstRef = useFocusOnMount<HTMLInputElement>();

  const ws = dashboard?.workspaces.find((w) => w.id === wsId);
  const existingTags = useMemo(() => collectTags(dashboard?.workspaces ?? []), [dashboard]);
  const id = (n: string) => `${uid}-${n}`;

  const changeWorkspace = (next: string) => {
    setWsId(next);
    const w = dashboard?.workspaces.find((x) => x.id === next);
    setGroupId(w?.groups[0]?.id ?? '__new__');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = 'Title is required.';
    const u = checkBookmarkUrl(url);
    if (!u.ok) errs.url = u.error;
    if (!ws) errs.workspace = 'Create a workspace first.';
    if (groupId === '__new__' && !newGroup.trim()) errs.group = 'Enter a name for the new group.';
    setErrors(errs);
    setFormError('');
    if (Object.keys(errs).length || !u.ok || !ws) return;

    const data = {
      title: title.trim(), url: u.url, description: description.trim(), environment, owner: owner.trim(), icon,
      tags: tagsText.split(',').map((t) => t.trim()).filter(Boolean), favorite, note,
    };
    setBusy(true);
    try {
      let targetGroup = groupId;
      if (groupId === '__new__') targetGroup = (await actions.createGroup(ws.id, newGroup.trim())).id;
      if (editing) {
        await actions.updateBookmark(editing.bookmark.id, data);
        if (targetGroup !== editing.group.id) await actions.moveBookmark(editing.bookmark.id, targetGroup, 9999);
        toast('success', 'Bookmark updated.');
      } else {
        await actions.createBookmark(targetGroup, data);
        toast('success', 'Bookmark added.');
      }
      closeDialog();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        setErrors(err.fields);
        setFormError('Please correct the highlighted fields.');
      } else setFormError(err instanceof Error ? err.message : 'Saving failed.');
    } finally {
      setBusy(false);
    }
  }

  const err = (k: string) => errors[k];
  return (
    <Modal
      title={editing ? 'Edit bookmark' : 'Add bookmark'}
      onClose={closeDialog}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>Cancel</button>
          <button type="submit" form={id('form')} className="btn btn-primary" disabled={busy}>{editing ? 'Save changes' : 'Add bookmark'}</button>
        </>
      }
    >
      <form id={id('form')} onSubmit={submit} noValidate className="form-grid">
        {formError && <p className="form-error full" role="alert">{formError}</p>}
        <Field label="Title" htmlFor={id('title')} error={err('title')}>
          <input ref={firstRef} id={id('title')} value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!err('title')} aria-describedby={err('title') ? `${id('title')}-error` : undefined} required />
        </Field>
        <Field label="URL" htmlFor={id('url')} error={err('url')} hint="http:// or https:// - internal host names and ports are fine.">
          <input id={id('url')} value={url} inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://kibana.example.org:5601/app" onChange={(e) => setUrl(e.target.value)} aria-invalid={!!err('url')} aria-describedby={err('url') ? `${id('url')}-error` : `${id('url')}-hint`} required />
        </Field>
        <div className="full">
          <Field label="Description (optional)" htmlFor={id('desc')} error={err('description')}>
            <input id={id('desc')} value={description} maxLength={LIMITS.description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Field label="Workspace" htmlFor={id('ws')} error={err('workspace')}>
          <select id={id('ws')} value={wsId} onChange={(e) => changeWorkspace(e.target.value)}>
            {dashboard?.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Group" htmlFor={id('group')} error={err('group')}>
          <select id={id('group')} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {ws?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="__new__">+ New group...</option>
          </select>
        </Field>
        {groupId === '__new__' && (
          <div className="full">
            <Field label="New group name" htmlFor={id('newgroup')} error={err('group')}>
              <input id={id('newgroup')} value={newGroup} maxLength={LIMITS.name} onChange={(e) => setNewGroup(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Environment" htmlFor={id('env')}>
          <select id={id('env')} value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)}>
            {ENVIRONMENTS.map((e) => <option key={e} value={e}>{ENVIRONMENT_LABELS[e]}</option>)}
          </select>
        </Field>
        <Field label="Service owner / team (optional)" htmlFor={id('owner')} error={err('owner')}>
          <input id={id('owner')} value={owner} maxLength={LIMITS.owner} onChange={(e) => setOwner(e.target.value)} />
        </Field>
        <div className="full">
          <Field label="Tags (comma separated)" htmlFor={id('tags')} error={err('tags')} hint={`Up to ${LIMITS.tagsPerBookmark} tags, ${LIMITS.tag} characters each.`}>
            <input id={id('tags')} value={tagsText} list={id('taglist')} placeholder="elastic, logs, prod" onChange={(e) => setTagsText(e.target.value)} />
            <datalist id={id('taglist')}>{existingTags.slice(0, 50).map((t) => <option key={t.tag} value={t.tag} />)}</datalist>
          </Field>
        </div>
        <div className="full field">
          <span className="label" id={id('icon-label')}>Icon</span>
          <IconPicker value={icon} onChange={setIcon} label="Icon" />
        </div>
        <div className="full">
          <Field label="Operational note (optional, plain text)" htmlFor={id('note')} error={err('note')} hint="Do not store passwords, tokens or other secrets.">
            <textarea id={id('note')} rows={3} value={note} maxLength={LIMITS.note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <label className="check full">
          <input type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} />
          <span>Pin to the top of the dashboard (favorite)</span>
        </label>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- details */

function DetailsDialog({ id }: { id: string }) {
  const { findBookmark, closeDialog, openDialog } = useStore();
  const f = findBookmark(id);
  if (!f) return null;
  const { bookmark: b, group, workspace } = f;
  return (
    <Modal
      title={b.title}
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="btn" onClick={() => openDialog({ type: 'bookmark', mode: 'edit', bookmarkId: id })}>Edit</button>
          <button type="button" className="btn btn-primary" onClick={closeDialog}>Close</button>
        </>
      }
    >
      <dl className="details">
        <dt>URL</dt><dd className="mono wrap">{b.url}</dd>
        <dt>Location</dt><dd>{workspace.name} / {group.name}</dd>
        <dt>Environment</dt><dd><EnvBadge env={b.environment} /></dd>
        {b.owner && (<><dt>Owner</dt><dd>{b.owner}</dd></>)}
        {b.description && (<><dt>Description</dt><dd className="pre">{b.description}</dd></>)}
        {b.tags.length > 0 && (<><dt>Tags</dt><dd className="tags">{b.tags.map((t) => <span key={t} className="tag">{t}</span>)}</dd></>)}
        {b.note && (<><dt>Note</dt><dd className="pre note-text">{b.note}</dd></>)}
        <dt>Created</dt><dd>{formatDate(b.createdAt)}</dd>
        <dt>Modified</dt><dd>{formatDate(b.updatedAt)}</dd>
        <dt>Last opened here</dt><dd>{formatDate(b.lastOpenedAt)}</dd>
      </dl>
    </Modal>
  );
}

function DeleteBookmarkDialog({ id }: { id: string }) {
  const { findBookmark, closeDialog, actions, run } = useStore();
  const f = findBookmark(id);
  if (!f) return null;
  return (
    <ConfirmModal
      title="Delete bookmark?"
      danger
      confirmLabel="Delete bookmark"
      message={<p>"<strong>{f.bookmark.title}</strong>" will be removed from {f.workspace.name} / {f.group.name}. This cannot be undone (an automatic backup is created on each start-up, and you can create one in Settings).</p>}
      onClose={closeDialog}
      onConfirm={async () => {
        closeDialog();
        await run(() => actions.deleteBookmark(id), 'Bookmark deleted.');
      }}
    />
  );
}

function MoveBookmarkDialog({ id }: { id: string }) {
  const { dashboard, findBookmark, closeDialog, actions, run } = useStore();
  const f = findBookmark(id);
  const [wsId, setWsId] = useState(f?.workspace.id ?? '');
  const [groupId, setGroupId] = useState(f?.group.id ?? '');
  const uid = useId();
  const ws = dashboard?.workspaces.find((w) => w.id === wsId);
  if (!f || !dashboard) return null;
  return (
    <Modal
      title="Move bookmark"
      description={`Move "${f.bookmark.title}" to another group. It is placed at the end of the target group.`}
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!groupId || groupId === f.group.id} onClick={async () => {
            closeDialog();
            await run(() => actions.moveBookmark(id, groupId, 9999), 'Bookmark moved.');
          }}>Move</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Workspace" htmlFor={`${uid}-w`}>
          <select id={`${uid}-w`} value={wsId} onChange={(e) => { setWsId(e.target.value); setGroupId(dashboard.workspaces.find((w) => w.id === e.target.value)?.groups[0]?.id ?? ''); }}>
            {dashboard.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="Group" htmlFor={`${uid}-g`}>
          <select id={`${uid}-g`} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {ws?.groups.length ? ws.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>) : <option value="">(no groups - create one first)</option>}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ name dialogs */

type NameState = Extract<DialogState, { type: 'name' }>;

function NameDialog({ d }: { d: NameState }) {
  const { dashboard, closeDialog, actions, toast } = useStore();
  const uid = useId();
  const ws = d.kind === 'workspace-edit' ? dashboard?.workspaces.find((w) => w.id === d.id) : undefined;
  const group = d.kind === 'group-rename' ? dashboard?.workspaces.flatMap((w) => w.groups).find((g) => g.id === d.id) : undefined;
  const initial = d.kind === 'title' ? (dashboard?.title ?? '') : (ws?.name ?? group?.name ?? '');
  const [name, setName] = useState(initial);
  const [icon, setIcon] = useState<string | null>(ws?.icon ?? 'layout-dashboard');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useFocusOnMount<HTMLInputElement>();

  const heading = {
    'workspace-create': 'New workspace', 'workspace-edit': 'Edit workspace', 'group-create': 'New group',
    'group-rename': 'Rename group', title: 'Dashboard title',
  }[d.kind];
  const max = d.kind === 'title' ? LIMITS.dashboardTitle : LIMITS.name;
  const withIcon = d.kind === 'workspace-create' || d.kind === 'workspace-edit';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('A name is required.');
    setBusy(true);
    try {
      if (d.kind === 'workspace-create') {
        const w = await actions.createWorkspace(name.trim(), icon ?? undefined);
        navigate(workspacePath(w.id));
      } else if (d.kind === 'workspace-edit') await actions.updateWorkspace(d.id, { name: name.trim(), icon: icon ?? undefined });
      else if (d.kind === 'group-create') await actions.createGroup(d.workspaceId, name.trim());
      else if (d.kind === 'group-rename') await actions.updateGroup(d.id, { name: name.trim() });
      else await actions.setTitle(name.trim());
      toast('success', 'Saved.');
      closeDialog();
    } catch (err) {
      setError(err instanceof ApiError && err.fields.name ? err.fields.name : err instanceof Error ? err.message : 'Saving failed.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={heading}
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>Cancel</button>
          <button type="submit" form={`${uid}-f`} className="btn btn-primary" disabled={busy}>Save</button>
        </>
      }
    >
      <form id={`${uid}-f`} onSubmit={submit} noValidate>
        <Field label={d.kind === 'title' ? 'Title' : 'Name'} htmlFor={`${uid}-n`} error={error}>
          <input ref={ref} id={`${uid}-n`} value={name} maxLength={max} onChange={(e) => { setName(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? `${uid}-n-error` : undefined} />
        </Field>
        {withIcon && (
          <div className="field">
            <span className="label">Icon</span>
            <IconPicker value={icon} onChange={setIcon} allowAuto={false} label="Workspace icon" />
          </div>
        )}
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------- delete group/workspace */

function DeleteStructureDialog({ kind, id }: { kind: 'group' | 'workspace'; id: string }) {
  const { dashboard, closeDialog, actions, run } = useStore();
  const route = useRoute();
  const uid = useId();
  const ws = kind === 'workspace' ? dashboard?.workspaces.find((w) => w.id === id) : undefined;
  const group = kind === 'group' ? dashboard?.workspaces.flatMap((w) => w.groups).find((g) => g.id === id) : undefined;
  const name = ws?.name ?? group?.name ?? '';
  const nGroups = ws?.groups.length ?? 0;
  const nBookmarks = ws ? ws.groups.reduce((n, g) => n + g.bookmarks.length, 0) : (group?.bookmarks.length ?? 0);
  const nonEmpty = kind === 'workspace' ? nGroups > 0 : nBookmarks > 0;

  const targets = useMemo(() => {
    if (!dashboard) return [] as { id: string; label: string }[];
    if (kind === 'workspace') return dashboard.workspaces.filter((w) => w.id !== id).map((w) => ({ id: w.id, label: w.name }));
    return dashboard.workspaces.flatMap((w) => w.groups.filter((g) => g.id !== id).map((g) => ({ id: g.id, label: `${w.name} / ${g.name}` })));
  }, [dashboard, kind, id]);

  const [mode, setMode] = useState<'move' | 'delete'>(targets.length ? 'move' : 'delete');
  const [target, setTarget] = useState(targets[0]?.id ?? '');
  if (!dashboard || (!ws && !group)) return null;

  const what = kind === 'workspace' ? `${plural(nGroups, 'group')} (${plural(nBookmarks, 'bookmark')})` : plural(nBookmarks, 'bookmark');

  async function confirm() {
    closeDialog();
    const doDelete = kind === 'workspace' ? actions.deleteWorkspace : actions.deleteGroup;
    const ok = await run(async () => {
      await doDelete(id, nonEmpty ? mode : undefined, nonEmpty && mode === 'move' ? target : undefined);
      return true;
    }, `${kind === 'workspace' ? 'Workspace' : 'Group'} deleted.`);
    if (ok && kind === 'workspace' && route.name === 'workspace' && route.id === id) navigate('/', { replace: true });
  }

  return (
    <Modal
      title={`Delete ${kind} "${name}"?`}
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={nonEmpty && mode === 'move' && !target} onClick={confirm}>
            {nonEmpty ? (mode === 'move' ? `Move, then delete ${kind}` : `Delete ${kind} and contents`) : `Delete ${kind}`}
          </button>
        </>
      }
    >
      {!nonEmpty ? (
        <p>This {kind} is empty and will be removed.</p>
      ) : (
        <fieldset className="choice">
          <legend>This {kind} contains {what}. What should happen to them?</legend>
          <label className="radio">
            <input type="radio" name={`${uid}-m`} checked={mode === 'move'} disabled={targets.length === 0} onChange={() => setMode('move')} />
            <span>Move them to another {kind === 'workspace' ? 'workspace' : 'group'}</span>
          </label>
          {mode === 'move' && (
            <div className="indent">
              <label htmlFor={`${uid}-t`} className="sr-only">Destination</label>
              <select id={`${uid}-t`} value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          )}
          {targets.length === 0 && <p className="field-hint">There is nowhere to move them - create another {kind} first.</p>}
          <label className="radio danger-text">
            <input type="radio" name={`${uid}-m`} checked={mode === 'delete'} onChange={() => setMode('delete')} />
            <span>Permanently delete {what}</span>
          </label>
        </fieldset>
      )}
    </Modal>
  );
}

function MoveGroupDialog({ id }: { id: string }) {
  const { dashboard, closeDialog, actions, run } = useStore();
  const uid = useId();
  const group = dashboard?.workspaces.flatMap((w) => w.groups).find((g) => g.id === id);
  const [wsId, setWsId] = useState(group?.workspaceId ?? '');
  if (!dashboard || !group) return null;
  return (
    <Modal
      title="Move group to workspace"
      description={`Move "${group.name}" and its bookmarks to another workspace.`}
      onClose={closeDialog}
      footer={
        <>
          <button type="button" className="btn" onClick={closeDialog}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={wsId === group.workspaceId} onClick={async () => {
            closeDialog();
            await run(() => actions.moveGroup(id, wsId, 9999), 'Group moved.');
          }}>Move</button>
        </>
      }
    >
      <Field label="Workspace" htmlFor={`${uid}-w`}>
        <select id={`${uid}-w`} value={wsId} onChange={(e) => setWsId(e.target.value)}>
          {dashboard.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </Field>
    </Modal>
  );
}
