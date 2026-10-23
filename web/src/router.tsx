import { useCallback, useMemo, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

/**
 * Tiny History-API router (no dependency). Routes:
 *   /            workspace selection (home)
 *   /w/<id>      a workspace
 *   /settings    settings, data and backups
 * The server answers every non-API path with the app shell, so reload and deep links work.
 */
export type Route = { name: 'home' } | { name: 'workspace'; id: string } | { name: 'settings' } | { name: 'unknown' };

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { name: 'home' };
  if (path === '/settings') return { name: 'settings' };
  const m = /^\/w\/([^/]+)$/.exec(path);
  if (m) {
    try {
      return { name: 'workspace', id: decodeURIComponent(m[1]!) };
    } catch {
      return { name: 'unknown' };
    }
  }
  return { name: 'unknown' };
}

export const workspacePath = (id: string) => `/w/${encodeURIComponent(id)}`;

const NAV_EVENT = 'opsdesk:navigate';

function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(NAV_EVENT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(NAV_EVENT, cb);
  };
}
const snapshot = () => window.location.pathname;

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === window.location.pathname) return;
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, snapshot, () => '/');
  return useMemo(() => parseRoute(path), [path]);
}

export function useNavigate() {
  return useCallback((to: string, opts?: { replace?: boolean }) => navigate(to, opts), []);
}

/** Real anchor (middle-click, copy link, keyboard Enter all work); plain left-clicks navigate without a reload. */
export function Link({ to, onClick, children, ...rest }: { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}
