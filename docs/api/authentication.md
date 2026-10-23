# Authentication

## Overview

| Client | Credential | Used for |
| --- | --- | --- |
| **CLI / scripts** (curl, CI jobs) | `Authorization: Bearer <token>` | every operation |
| **Bundled web UI** | its own same-origin session: browser `Origin` + per-process CSRF token | the UI only; not an API credential |
| **Anyone, on localhost** | none | `GET` requests (reads), health, version, capabilities |

The token is configured **on the server** with `OPSDESK_API_TOKEN` (or `OPSDESK_API_TOKEN_FILE`, a path to a file containing it). It is never committed, never embedded in the frontend, never returned by any endpoint (including `/health`, `/capabilities` and `/session`) and never written to logs.

```ini title=".env"
# 24-256 characters from A-Z a-z 0-9 . _ ~ + / = -     (generate: npm run token:generate)
OPSDESK_API_TOKEN=<48-character random token>
```

Restart after changing it. A malformed token stops the start-up with a clear error that does not print the value.

## Rules

- **Changing data requires authentication.** `POST`, `PATCH` and `DELETE` without credentials return `401 authentication_required` (`WWW-Authenticate: Bearer`). If no token is configured, a bearer attempt returns `401 api_auth_not_configured`: API mutations stay disabled until you set `OPSDESK_API_TOKEN`.
- **Wrong token** -> `401 invalid_token`. After 20 failed attempts within a minute the server answers `429 too_many_requests` (`Retry-After`) for a while. Comparison is constant-time.
- **No Origin needed:** curl and other non-browser clients send no `Origin` header; with a valid token they are accepted. A **browser** request carrying an `Origin` is only accepted if it is this server or one of the explicitly configured origins below.
- **Strict Host checking** applies to everything (DNS-rebinding protection). Only `localhost`, `127.0.0.1`, `[::1]` and names you list in `allowedHosts` are accepted.
- **HTTPS beyond localhost:** if you address the server with any host name other than `localhost`/`127.0.0.1`/`[::1]`, a request carrying a token must use HTTPS, otherwise `403 https_required`. Terminate TLS in a reverse proxy and set `OPSDESK_TRUST_PROXY=1` so `X-Forwarded-Proto: https` is honoured. OpsDesk itself does not serve TLS and, being single-user, has no per-user accounts: see the [security model](../operations/security.md).
- **CSRF:** a token in the `Authorization` header cannot be attached by a malicious web page, so bearer requests need no CSRF token. UI requests (no `Authorization` header) still need same-origin `Origin`, `Content-Type: application/json` and the CSRF token, exactly as before.

## Authentication per endpoint

| Endpoint class | Credential |
| --- | --- |
| `GET /health`, `/version`, `/capabilities`, `/openapi.json` | none |
| Other `GET` endpoints (`/dashboard`, `/workspaces`, `/groups`, `/bookmarks`, `/tags`, `/environments`, `/recent`, `/settings`, `/export`, `/backups`, downloads) | none on localhost; bearer accepted; **bearer required for browser calls from another origin** |
| Every `POST`, `PATCH`, `DELETE` | **bearer token** (or the UI session) |
| `multipart/form-data` uploads (`/import/preview`, `/import/apply`) | **bearer token only** |

Each operation in the [OpenAPI document](reference.md) lists its own `security` requirement; GET endpoints show "no authentication, or bearer".

## Browser-based API clients (CORS)

There is no wildcard CORS. To call the API from a page served by another origin (for example the documentation preview on `http://127.0.0.1:8000`), list that exact origin:

```ini title=".env"
OPSDESK_CORS_ORIGINS=http://127.0.0.1:8000
```

or in `opsdesk.config.json`: `"corsOrigins": ["http://127.0.0.1:8000"]`. Entries must be exact origins (scheme, host, optional port; no path, no `*`). Listed origins receive `Access-Control-Allow-Origin: <that origin>` (never `*`), may answer pre-flight requests, and **must still send the bearer token**; cookies and credentials are never allowed. Other origins get `403 bad_origin`/`405`.

## What the API will never do

These stay in server configuration and are deliberately **not readable or writable through HTTP**:

- selecting or switching the database engine, database URLs and credentials (the active engine is visible read-only in `/capabilities`);
- the API token itself, CORS origins, host/port/TLS settings, data and backup directories, any file-system path (backup names are validated, downloads are limited to the backups folder);
- starting, stopping or reconfiguring the process; running SQL or shell commands;
- launching a browser (opening a bookmark means recording an event; the URL is returned for the client to open).

## Checking it works

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/workspaces" -H 'Content-Type: application/json' -d '{"name":"x"}'     # 401: no credentials
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/workspaces" -H 'Authorization: Bearer wrong' -d '{}'                    # 401: invalid token
```
