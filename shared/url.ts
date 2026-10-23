import { LIMITS } from './constants.js';

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

/**
 * Validates a bookmark destination. Only http: and https: are accepted.
 * Internal hostnames, custom ports, paths, query strings and fragments are allowed.
 * Embedded credentials (user:pass@host) are rejected so secrets are not stored in URLs.
 * Returns the normalised URL (WHATWG `href`).
 */
export function checkBookmarkUrl(input: unknown): UrlCheck {
  if (typeof input !== 'string') return { ok: false, error: 'URL is required.' };
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'URL is required.' };
  if (raw.length > LIMITS.url) return { ok: false, error: `URL must be at most ${LIMITS.url} characters.` };
  if (CONTROL_OR_SPACE.test(raw)) return { ok: false, error: 'URL must not contain spaces or control characters.' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'Enter a complete URL such as https://kibana.example.org:5601/app.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// URLs are allowed.' };
  }
  if (!parsed.hostname) return { ok: false, error: 'URL must include a host name.' };
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'URLs must not contain a user name or password. Do not store credentials in bookmarks.' };
  }
  return { ok: true, url: parsed.href };
}

/** Key used to decide whether two bookmarks point to the same destination. */
export function urlKey(url: string): string {
  const check = checkBookmarkUrl(url);
  return check.ok ? check.url : url.trim();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
