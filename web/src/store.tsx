import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BookmarkData } from './types-ui';
import { EMPTY_FILTERS, type FilterState } from '../../shared/search';
import type { Bookmark, Dashboard, Group, SessionInfo, Workspace } from '../../shared/types';
import { api, ApiError, loadSession } from './api';
import { navigate, useRoute } from './router';

export type Theme = 'dark' | 'light' | 'system';
export type Density = 'compact' | 'comfortable';
export type View = 'home' | 'dashboard' | 'settings';

interface Prefs {
  theme: Theme;
  density: Density;
  sidebarCollapsed: boolean;
  workspaceId: string | null;
}

export type DialogState =
  | { type: 'bookmark'; mode: 'create'; groupId?: string }
  | { type: 'bookmark'; mode: 'edit'; bookmarkId: string }
  | { type: 'details'; bookmarkId: string }
  | { type: 'delete-bookmark'; bookmarkId: string }
  | { type: 'move-bookmark'; bookmarkId: string }
  | { type: 'name'; kind: 'workspace-create' }
  | { type: 'name'; kind: 'workspace-edit'; id: string }
  | { type: 'name'; kind: 'group-create'; workspaceId: string }
  | { type: 'name'; kind: 'group-rename'; id: string }
  | { type: 'name'; kind: 'title' }
  | { type: 'delete-structure'; kind: 'group' | 'workspace'; id: string }
  | { type: 'move-group'; id: string }
  | { type: 'palette' }
  | null;

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

const PREF_KEY = 'opsdesk.prefs.v1';
const DEFAULT_PREFS: Prefs = { theme: 'dark', density: 'comfortable', sidebarCollapsed: false, workspaceId: null };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      return {
        theme: p.theme === 'light' || p.theme === 'system' ? p.theme : 'dark',
        density: p.density === 'compact' ? 'compact' : 'comfortable',
        sidebarCollapsed: p.sidebarCollapsed === true,
        workspaceId: typeof p.workspaceId === 'string' ? p.workspaceId : null,
      };
    }
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return DEFAULT_PREFS;
}

export function useResolvedTheme(theme: Theme): 'dark' | 'light' {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSystemDark(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

interface Ctx {
  dashboard: Dashboard | null;
  session: SessionInfo | null;
  loadError: string | null;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  /** Derived from the URL: home (workspace selection), dashboard (a workspace) or settings. */
  view: View;
  /** Workspace in the URL when on a workspace route (null when it does not exist); otherwise the last used one. */
  workspace: Workspace | null;
  /** True when the URL names a workspace id that does not exist. */
  workspaceMissing: boolean;
  filters: FilterState;
  setFilters: (f: Partial<FilterState>) => void;
  clearFilters: () => void;
  dialog: DialogState;
  openDialog: (d: DialogState) => void;
  closeDialog: () => void;
  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
  reload: () => Promise<void>;
  /** Runs an action, shows an error toast on failure and an optional success toast. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  findBookmark: (id: string) => { bookmark: Bookmark; group: Group; workspace: Workspace } | null;
  actions: ReturnType<typeof buildActions>;
}

const StoreContext = createContext<Ctx | null>(null);

export function useStore(): Ctx {
  const v = useContext(StoreContext);
  if (!v) throw new Error('StoreContext missing');
  return v;
}

function buildActions(reload: () => Promise<void>) {
  const mut = async <T,>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await api<T>(method, path, body);
    await reload();
    return r;
  };
  return {
    createBookmark: (groupId: string, data: BookmarkData) => mut<Bookmark>('POST', `/groups/${groupId}/bookmarks`, data),
    updateBookmark: (id: string, data: Partial<BookmarkData>) => mut<Bookmark>('PATCH', `/bookmarks/${id}`, data),
    deleteBookmark: (id: string) => mut('DELETE', `/bookmarks/${id}`, {}),
    duplicateBookmark: (id: string) => mut<Bookmark>('POST', `/bookmarks/${id}/duplicate`, {}),
    moveBookmark: (id: string, groupId: string, index: number) => mut('POST', `/bookmarks/${id}/move`, { groupId, index }),
    recordOpen: async (id: string) => {
      try {
        await api('POST', `/bookmarks/${id}/opened`, {});
        await reload();
      } catch {
        /* recording a launch must never get in the way of opening the link */
      }
    },
    createGroup: (workspaceId: string, name: string) => mut<Group>('POST', `/workspaces/${workspaceId}/groups`, { name }),
    updateGroup: (id: string, patch: { name?: string; collapsed?: boolean }) => mut<Group>('PATCH', `/groups/${id}`, patch),
    moveGroup: (id: string, workspaceId: string | undefined, index: number) => mut('POST', `/groups/${id}/move`, { workspaceId, index }),
    deleteGroup: (id: string, mode?: 'delete' | 'move', targetId?: string) => mut('DELETE', `/groups/${id}`, { mode, targetId }),
    createWorkspace: (name: string, icon?: string) => mut<Workspace>('POST', '/workspaces', { name, icon }),
    updateWorkspace: (id: string, patch: { name?: string; icon?: string }) => mut<Workspace>('PATCH', `/workspaces/${id}`, patch),
    moveWorkspace: (id: string, index: number) => mut('POST', `/workspaces/${id}/move`, { index }),
    deleteWorkspace: (id: string, mode?: 'delete' | 'move', targetId?: string) => mut('DELETE', `/workspaces/${id}`, { mode, targetId }),
    setTitle: (title: string) => mut('PATCH', '/settings', { title }),
    completeSetup: (choice: 'sample' | 'empty') => mut('POST', '/setup', { choice }),
    removeSample: () => mut<{ bookmarks: number; groups: number; workspaces: number }>('POST', '/sample-data/remove', {}),
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const route = useRoute();
  const [filters, setFiltersState] = useState<FilterState>(EMPTY_FILTERS);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      try {
        localStorage.setItem(PREF_KEY, JSON.stringify(next));
      } catch {
        /* preferences are disposable */
      }
      return next;
    });
  }, []);

  const reload = useCallback(async () => {
    try {
      const d = await api<Dashboard>('GET', '/dashboard');
      setDashboard(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load the dashboard.');
      throw e;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadSession();
        if (cancelled) return;
        setSession(s);
        await reload();
      } catch {
        /* loadError already set by reload; session failure handled below */
        if (!cancelled) setLoadError((cur) => cur ?? 'Cannot reach the OpsDesk server. Start it and reload this page.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const resolved = useResolvedTheme(prefs.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  useEffect(() => {
    if (dashboard) document.title = dashboard.title;
  }, [dashboard]);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 3500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast('success', success);
        return r;
      } catch (e) {
        toast('error', e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
        return undefined;
      }
    },
    [toast],
  );

  const view: View = route.name === 'workspace' ? 'dashboard' : route.name === 'settings' ? 'settings' : 'home';
  const routeWorkspace = useMemo(
    () => (route.name === 'workspace' && dashboard ? (dashboard.workspaces.find((w) => w.id === route.id) ?? null) : null),
    [route, dashboard],
  );
  const workspaceMissing = route.name === 'workspace' && !!dashboard && !routeWorkspace;
  const workspace = useMemo(() => {
    if (!dashboard) return null;
    if (route.name === 'workspace') return routeWorkspace;
    // Not on a workspace route: expose the last used workspace without changing the selection.
    return dashboard.workspaces.find((w) => w.id === prefs.workspaceId) ?? dashboard.workspaces[0] ?? null;
  }, [dashboard, route, routeWorkspace, prefs.workspaceId]);

  // Remember the workspace the user explicitly opened (never changed by visiting home or settings).
  useEffect(() => {
    if (routeWorkspace && routeWorkspace.id !== prefs.workspaceId) setPrefs({ workspaceId: routeWorkspace.id });
  }, [routeWorkspace, prefs.workspaceId, setPrefs]);

  useEffect(() => {
    if (route.name === 'unknown') navigate('/', { replace: true });
  }, [route]);

  const findBookmark = useCallback(
    (id: string) => {
      if (!dashboard) return null;
      for (const w of dashboard.workspaces) for (const g of w.groups) for (const b of g.bookmarks) {
        if (b.id === id) return { bookmark: b, group: g, workspace: w };
      }
      return null;
    },
    [dashboard],
  );

  const actions = useMemo(() => buildActions(reload), [reload]);

  const value: Ctx = {
    dashboard, session, loadError, prefs, setPrefs, view, workspace, workspaceMissing, filters,
    setFilters: (f) => setFiltersState((cur) => ({ ...cur, ...f })),
    clearFilters: () => setFiltersState((cur) => ({ ...cur, environments: [], tags: [], favoritesOnly: false })),
    dialog, openDialog: setDialog, closeDialog: () => setDialog(null),
    toasts, toast, dismissToast, reload, run, findBookmark, actions,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
