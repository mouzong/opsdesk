import type { ApiErrorBody, SessionInfo } from '../../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

let session: SessionInfo | null = null;

export async function loadSession(force = false): Promise<SessionInfo> {
  if (session && !force) return session;
  const res = await fetch('/api/session', { cache: 'no-store' });
  if (!res.ok) throw new ApiError('Cannot reach the OpsDesk server.', res.status, 'unreachable');
  session = (await res.json()) as SessionInfo;
  return session;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const s = await loadSession();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': s.csrfToken },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('Cannot reach the OpsDesk server. Is it still running?', 0, 'unreachable');
  }
  if (res.ok) return (await res.json()) as T;
  let err: ApiErrorBody | null = null;
  try {
    err = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  if (res.status === 403 && err?.error.code === 'csrf' && retry) {
    // The server was restarted: fetch a fresh token and try once more.
    await loadSession(true);
    return api<T>(method, path, body, false);
  }
  throw new ApiError(err?.error.message ?? `Request failed (${res.status}).`, res.status, err?.error.code ?? 'error', err?.error.fields);
}
