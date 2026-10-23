import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from './context.js';
import { AppError } from './errors.js';
import { allowedHostnames, hostnameOf } from './security.js';

export type AuthKind = 'bearer' | 'ui' | 'anonymous';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Assigns X-Request-Id (accepts a sane client-supplied one) so every response and error can be correlated with logs. */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const given = req.headers['x-request-id'];
    const id = typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Sliding-window limiter for FAILED credential checks only (brute-force protection). */
class FailureLimiter {
  private hits: number[] = [];
  constructor(private readonly max: number, private readonly windowMs: number) {}
  blocked(): number {
    const now = Date.now();
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    return this.hits.length >= this.max ? Math.ceil((this.windowMs - (now - this.hits[0]!)) / 1000) : 0;
  }
  fail() {
    this.hits.push(Date.now());
  }
}

const sameHost = (origin: string, hostHeader: string | undefined) => {
  try {
    return new URL(origin).host.toLowerCase() === (hostHeader ?? '').toLowerCase();
  } catch {
    return false;
  }
};

/**
 * API authentication, chosen by what the client presents:
 *
 *  1. `Authorization: Bearer <token>`  (CLI/automation; token from OPSDESK_API_TOKEN, never sent by the bundled UI)
 *     - works for every method, no CSRF token and no Origin required (curl),
 *     - a browser Origin, if present, must be this server or an explicitly configured CORS origin,
 *     - over a non-loopback host name it must use HTTPS.
 *  2. No Authorization header  (the bundled UI and anonymous reads)
 *     - reads are allowed (localhost trust, identical to the UI; cross-origin reads are impossible: no CORS),
 *     - mutations need a same-origin Origin header, a JSON content type and the per-process CSRF token.
 *       A client without Origin (curl) gets 401 and must use a bearer token.
 */
export function apiAuth(ctx: AppContext): RequestHandler {
  const hosts = allowedHostnames(ctx);
  const cors = new Set(ctx.config.corsOrigins);
  const limiter = new FailureLimiter(20, 60_000);
  const token = () => ctx.config.apiToken;

  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    const corsAllowed = origin !== undefined && cors.has(origin.toLowerCase());

    if (corsAllowed) {
      // Exact-origin CORS only (never "*"); credentials/cookies are never enabled.
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id, ETag, Location, Content-Disposition, Retry-After');
    }
    if (req.method === 'OPTIONS') {
      if (corsAllowed && req.headers['access-control-request-method']) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-Match, Idempotency-Key, X-Request-Id');
        res.setHeader('Access-Control-Max-Age', '600');
        res.status(204).end();
        return;
      }
      throw new AppError(405, 'method_not_allowed', 'CORS pre-flight requests are only accepted from explicitly configured origins (OPSDESK_CORS_ORIGINS).');
    }

    const authz = req.headers.authorization;
    if (authz !== undefined) {
      const wait = limiter.blocked();
      if (wait > 0) {
        res.setHeader('Retry-After', String(wait));
        throw new AppError(429, 'too_many_requests', 'Too many failed authentication attempts. Retry later.');
      }
      if (!LOOPBACK.has(hostnameOf(req.headers.host)) && !req.secure) {
        throw new AppError(403, 'https_required', 'API tokens must only be sent over HTTPS when the server is not addressed as localhost.');
      }
      const m = /^Bearer\s+(\S+)$/i.exec(authz);
      if (!m) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="opsdesk"');
        throw new AppError(401, 'invalid_authorization', 'Use the header "Authorization: Bearer <token>".');
      }
      const expected = token();
      if (expected === undefined) {
        throw new AppError(401, 'api_auth_not_configured', 'API token access is not enabled on this server. Set OPSDESK_API_TOKEN and restart.');
      }
      if (!safeEqual(m[1]!, expected)) {
        limiter.fail();
        res.setHeader('WWW-Authenticate', 'Bearer realm="opsdesk", error="invalid_token"');
        throw new AppError(401, 'invalid_token', 'The API token is not valid.');
      }
      if (origin !== undefined) {
        let hostname = '';
        try {
          hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
        } catch {
          throw new AppError(403, 'bad_origin', 'Invalid Origin header.');
        }
        const same = sameHost(origin, req.headers.host) && hosts.has(hostname);
        if (!same && !corsAllowed) throw new AppError(403, 'bad_origin', 'This origin is not allowed. Add it to OPSDESK_CORS_ORIGINS for a browser-based API client.');
      }
      res.locals.auth = 'bearer' satisfies AuthKind;
      next();
      return;
    }

    // ---- no Authorization header: bundled UI / anonymous reads ----
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') throw new AppError(403, 'cross_site', 'Cross-site requests are not allowed.');
    if (origin !== undefined && !sameHost(origin, req.headers.host)) {
      throw new AppError(403, 'cross_origin_requires_token', 'Cross-origin requests must authenticate with a bearer token (and the origin must be listed in OPSDESK_CORS_ORIGINS).');
    }
    if (!MUTATING.has(req.method)) {
      res.locals.auth = 'anonymous' satisfies AuthKind;
      next();
      return;
    }
    if (origin === undefined) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="opsdesk"');
      throw new AppError(401, 'authentication_required', 'Changing data requires authentication. Send "Authorization: Bearer <token>" (set OPSDESK_API_TOKEN on the server).');
    }
    let hostname = '';
    try {
      hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    } catch {
      throw new AppError(403, 'bad_origin', 'Invalid Origin header.');
    }
    if (!hosts.has(hostname)) throw new AppError(403, 'bad_origin', 'Cross-origin requests are not allowed.');
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') throw new AppError(415, 'unsupported_media_type', 'Requests must use Content-Type: application/json.');
    const csrf = req.headers['x-csrf-token'];
    if (csrf === undefined) {
      // Not the bundled UI (which always sends its CSRF token): tell API users how to authenticate instead of mentioning CSRF.
      res.setHeader('WWW-Authenticate', 'Bearer realm="opsdesk"');
      throw new AppError(401, 'authentication_required', 'Changing data requires authentication. Send "Authorization: Bearer <token>" (set OPSDESK_API_TOKEN on the server).');
    }
    if (typeof csrf !== 'string' || !safeEqual(csrf, ctx.csrfToken)) {
      throw new AppError(403, 'csrf', 'Missing or invalid CSRF token. Reload the page and try again.');
    }
    res.locals.auth = 'ui' satisfies AuthKind;
    next();
  };
}

/* ------------------------------------------------------------ idempotency */

interface Stored {
  fingerprint: string;
  at: number;
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** In-memory (per process) store for Idempotency-Key replays: 24 h, at most 2000 keys. */
export class IdempotencyStore {
  private readonly map = new Map<string, Stored>();
  constructor(private readonly ttlMs = 24 * 3600_000, private readonly max = 2000) {}
  get(key: string): Stored | undefined {
    const s = this.map.get(key);
    if (s && Date.now() - s.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return s;
  }
  set(key: string, value: Omit<Stored, 'at'>) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { ...value, at: Date.now() });
  }
}

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
export const fingerprint = (method: string, path: string, body: unknown) =>
  createHash('sha256').update(`${method} ${path} ${JSON.stringify(body ?? null)}`).digest('hex');
