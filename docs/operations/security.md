# Security model

OpsDesk is a **localhost application with no authentication**. Read this before changing anything network-related.

- Binds to `127.0.0.1` by default and **refuses** other addresses unless `allowNetwork` is set (Docker sets it inside the container while publishing the port on the host's loopback interface only).
- **Host header allow-list** (blocks DNS rebinding); **Origin must equal Host** on writes; writes require `Content-Type: application/json` and a per-process **CSRF token** that cross-origin pages cannot read; `Sec-Fetch-Site` cross-site requests are refused; **no CORS headers** are ever sent (pre-flights get 405).
- **HTTP API access** uses a server-side bearer token (`OPSDESK_API_TOKEN`) for every change from non-browser clients; the web UI keeps its same-origin + CSRF session. Tokens are compared in constant time, failed attempts are throttled, tokens must use HTTPS for non-local host names, CORS is limited to exact configured origins, and the token never appears in responses, logs, the frontend or the documentation. Details: [API authentication](../api/authentication.md).
- Strict CSP for the application (`default-src 'self'`, no inline scripts, no external origins), `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`.
- The documentation under `/docs/` uses the same server and headers, with one relaxation: its CSP additionally allows inline scripts, because MkDocs Material embeds a tiny colour-scheme bootstrap script. Everything else stays `'self'`; no external fonts, scripts, analytics or images are used or allowed.
- Only `http:`/`https:` URLs are accepted (server and client); `javascript:`, `data:`, `file:` are rejected, as are URLs with embedded `user:password@`. Links open with `target="_blank" rel="noopener noreferrer"`.
- Titles, descriptions, notes and imported text are rendered as plain text; SQL is parameterised; the server never fetches bookmarked URLs, downloads favicons, checks link health or runs commands.
- Logs contain `METHOD path status time` only - no query strings, bodies or bookmark data. Database credentials are never logged; start-up prints the engine name and whether TLS is on.
- Database credentials live only in the server process environment: not in API responses (including `/api/session` and `/api/health`), the frontend bundle, or the Docker image (`.env` is excluded).
- Bookmarks, notes and backups are **not encrypted**. Do not store passwords, tokens or secrets in them (Settings repeats this reminder).

!!! danger "Network exposure"
    To reach OpsDesk from another machine you would have to set `allowNetwork` and `allowedHosts` and, before that, add what a shared server needs: authentication, TLS (a reverse proxy), per-user authorisation and audit logging. That work is intentionally out of scope.
