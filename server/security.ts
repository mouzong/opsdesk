import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from './context.js';
import { AppError } from './errors.js';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

/** Extracts the host name (no port, no brackets, lower-case) from a Host header value. */
export function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  const i = h.lastIndexOf(':');
  return i === -1 ? h : h.slice(0, i);
}

export function allowedHostnames(ctx: AppContext): Set<string> {
  const s = new Set<string>(LOCAL_HOSTS);
  const bound = ctx.config.host.replace(/^\[|\]$/g, '').toLowerCase();
  if (bound !== '0.0.0.0' && bound !== '::') s.add(bound);
  for (const h of ctx.config.allowedHosts) s.add(h);
  return s;
}

function deny(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}

/** Blocks DNS-rebinding: only known host names may address the server. */
export function hostGuard(ctx: AppContext): RequestHandler {
  const allowed = allowedHostnames(ctx);
  return (req, _res, next) => {
    if (!allowed.has(hostnameOf(req.headers.host))) deny(403, 'host_not_allowed', 'This host name is not allowed.');
    next();
  };
}

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
        "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.removeHeader('X-Powered-By');
    next();
  };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * API request guard (no CORS is ever enabled, so browsers cannot read cross-origin responses):
 *  - Sec-Fetch-Site, when sent, must be same-origin (or none for direct navigation)
 *  - state-changing requests need an Origin equal to the Host they were sent to,
 *    a JSON content type, and the per-process CSRF token.
 */
export function apiGuard(ctx: AppContext): RequestHandler {
  const allowed = allowedHostnames(ctx);
  return (req: Request, _res: Response, next: NextFunction) => {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') deny(403, 'cross_site', 'Cross-site requests are not allowed.');

    if (req.method === 'OPTIONS') deny(405, 'method_not_allowed', 'CORS pre-flight requests are not supported.');
    if (!MUTATING.has(req.method)) return next();

    const origin = req.headers.origin;
    if (origin !== undefined) {
      let o: URL;
      try {
        o = new URL(origin);
      } catch {
        return deny(403, 'bad_origin', 'Invalid Origin header.');
      }
      const sameHost = o.host.toLowerCase() === (req.headers.host ?? '').toLowerCase();
      if (!sameHost || !allowed.has(o.hostname.replace(/^\[|\]$/g, '').toLowerCase())) {
        deny(403, 'bad_origin', 'Cross-origin requests are not allowed.');
      }
    }
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') deny(415, 'unsupported_media_type', 'Requests must use Content-Type: application/json.');
    if (!tokenMatches(req.headers['x-csrf-token'] as string | undefined, ctx.csrfToken)) {
      deny(403, 'csrf', 'Missing or invalid CSRF token. Reload the page and try again.');
    }
    next();
  };
}
