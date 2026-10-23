# Verification report

!!! note "Scope"
    This page records the verification of the database-engine and workspace-navigation work (release 1.1.0). Checks for the documentation site, version display and README workflow of release 1.2.0 are listed at the end.

## Release 1.1.0

Executed on 2026-10-22 on macOS (Apple silicon), Chrome (stable), Docker 29.8.2, **PostgreSQL 17.11** (`postgres:17-alpine`) and **MySQL 8.4.13** (`mysql:8.4`) running in real containers. Everything marked **Verified** was actually run; the last section lists what was **not**.

## Summary

| Check | Result |
| --- | --- |
| `npm run typecheck` (server + web, strict TS) | OK |
| `npm run build` | OK (`dist/server` + `dist/web`) |
| `npm test`, SQLite only (Node 24.14) | 65 passed, 1 skipped (needs external DBs) |
| `npm test`, **SQLite + PostgreSQL + MySQL** (Node 24.14) | **151 passed**, 6 skipped (SQLite-file backup/restore tests, not applicable to PostgreSQL/MySQL) |
| same, **Node 22.23** | 151 passed, 6 skipped |
| `npm run test:e2e` (Playwright, Chrome, production build) on **SQLite** | 3 / 3 passed |
| `npm run test:e2e` on **PostgreSQL** | 3 / 3 passed |
| `npm run test:e2e` on **MySQL** | 3 / 3 passed |
| `docker compose up` (default, SQLite) | only the `opsdesk` service is defined/started; healthy, non-root, read-only FS |
| `docker compose -f ... -f docker-compose.postgres.yml up` | PostgreSQL container healthy, app healthy, `"type": "postgresql"`, data in the DB (18 rows), survives app restart, no secret in logs/`/api/session` |
| `docker compose -f ... -f docker-compose.mysql.yml up` | same on MySQL (`"type": "mysql"`) |
| compose without `POSTGRES_PASSWORD` | refused with a clear message |
| Clean-room install from the lockfile (previous release) and `npm audit` | 0 vulnerabilities (re-run after adding `pg`/`mysql2`: 0) |

## Requested validation items

| # | Requirement | Evidence |
| --- | --- | --- |
| 1 | Existing SQLite data remains accessible | `legacy.test.ts` builds a database exactly as 1.0.0 wrote it (schema v1, `PRAGMA user_version=1`, no `schema_migrations`) and checks title, setup flag, workspace/group/bookmark order, collapsed flags, tags, notes, favorites, last-opened, then writes through the API and restarts. Also verified manually: a **real file written by the 1.0.0 build** (18 sample bookmarks) opened with the new code - all data present, migrations 1 (adopted) and 2 (applied), `health_probe` empty, health green. |
| 2 | CRUD, ordering, import/export on each engine | The repository suite, the HTTP API suite (URL safety, HTML-like text, limits, cross-origin rejection, restart persistence, export/import round trip, merge/duplicates, invalid-import rollback, HTML import) and the 3 browser tests run on **SQLite, PostgreSQL and MySQL** - all green. Extra engine-sensitive tests: field round-trip (booleans, JSON tags, unicode, 3000-char notes, NULL icon), CHECK-constraint rejection, foreign-key enforcement + cascade, dense ordering after moves, upsert of the title, concurrent writes. **Found and fixed by these tests:** on PostgreSQL/MySQL concurrent writes produced duplicate positions; write transactions are now serialised in-process (SQLite already was). |
| 2b | Moving data between engines | `engines.test.ts`: SQLite -> PostgreSQL -> SQLite and SQLite -> MySQL -> SQLite via export + Replace import; exports compared byte-for-byte (apart from `exportedAt`): identical. |
| 3 | Migrations apply on each engine | Every test run starts external databases from empty tables (drop + migrate), so migrations 1 and 2 ran many times on PostgreSQL and MySQL; `current_version` is `"2"` on all three. Docker stacks migrated fresh databases as well. |
| 4 | Health: healthy / degraded / unavailable / timeout | `health.test.ts`, run on all three engines: **green** 200 (structure, version from `package.json`, engine type, `data_directory_writable` `true` vs `"not_applicable"`); **yellow** 200 when the backups path is unusable (writes still work); **red** 503 for a failing write probe (`write_failed`), pending migrations (`migrations_pending`), closed database (`read_failed`, recovers after reopening); **timeout**: a database that never answers returns 503 with `timed_out: true` and `error: "timeout"` in < 1.5 s (200 ms bound); a slow-but-successful check is *not* flagged; cache/coalescing; the probe leaves `health_probe` empty and user tables unchanged. |
| 5 | Sensitive configuration never in health responses or frontend assets | `health.test.ts`: response text contains none of the data directory, `tmp`, password, `postgres://`/`mysql://`, host, `node_modules`, `Error:`, stack markers - also while the database is down. `engines.test.ts`: for PostgreSQL and MySQL, `/api/session`, `/dashboard`, `/health`, `/export`, `/backups`, error responses, import-preview errors and the served `index.html` contain neither the password, the URL, the host:port nor the user. The compiled `dist/web` files contain no connection strings/credentials. `config.test.ts`: errors never echo the URL/password; credentials are redacted if the connection object is serialised. Docker logs and `/api/session` checked manually. |
| 6 | Logo / product name returns to workspace selection | Playwright: link `"Go to workspace selection"` (`href="/"`) from a workspace, Settings, search results, the command palette entry, and "Workspace not found"; **no full page load** (a `window` marker survives); selected workspace unchanged ("Last opened" badge); keyboard Tab focus shows a 2 px solid outline, Enter activates. |
| 7 | Workspace selection and browser navigation | Playwright: Back/Forward between a workspace and home, opening a workspace from the cards, deep link + reload on `/w/<id>` and `/settings`, unknown id -> "Workspace not found", unknown path -> redirected home, create / rename / delete from the selection screen, create opens the new workspace. Same on PostgreSQL and MySQL. |
| 8 | Production build | `npm run build` OK; production server started with `npm start` on Node 22.23 and 24.14; Docker images built from the Dockerfile (`opsdesk:1.1.0`). |

## Configuration behaviour (Verified)

- Unsupported engine, missing URL, URL with `sqlite`, bad scheme, query parameters, bad numbers: clear errors, no secrets (`config.test.ts`, and from the real CLI).
- **No silent fallback**: an unreachable server (`ECONNREFUSED`) and a wrong password against the real PostgreSQL (`28P01`) stop the start-up with a sanitized message; no SQLite file is created.
- TLS (PostgreSQL with a self-signed certificate, real container): default verification **refuses** (`DEPTH_ZERO_SELF_SIGNED_CERT`); with `OPSDESK_DB_SSL_CA_FILE` it connects with verification on; `OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY=1` connects unverified. MySQL: verification on refuses the server's auto-generated certificate (`HANDSHAKE_SSL_ERROR`); skip-verify connects. `auto` = TLS for non-localhost hosts (unit-tested).
- `.env` is loaded by `npm start` on Node 22.23 and 24.14.
- `OPSDESK_DATABASE_URL_FILE` read and mutual exclusion with `OPSDESK_DATABASE_URL` (unit-tested).
- Native backups verified: `pg_dump -Fc` + `pg_restore --clean`, and `mysqldump --single-transaction` + `mysql <` restore (row counts back to original). SQLite `npm run backup`/`restore` unchanged; both refuse to run for PostgreSQL/MySQL (checked).

## Not verified / limitations

- **Windows/PowerShell and Linux hosts**: commands are written for them but were never executed there. `docker compose` bind-mount permissions on Linux/Windows hosts untested.
- **MariaDB and PostgreSQL < 17 / MySQL < 8.4** are expected to work (MySQL >= 8.0.16, PostgreSQL >= 13 documented) but were not run.
- **TLS with certificate hostname matching for MySQL** and TLS-only server policies (`require_secure_transport`) were not exercised end to end; PostgreSQL TLS was.
- **Multiple OpsDesk instances on one external database** are unsupported (write serialisation is in-process); not tested.
- Managed cloud databases (RDS, Cloud SQL, Azure) and connection poolers (PgBouncer in transaction mode) not tested.
- Large datasets (the 20 000-bookmark limit) not load-tested on any engine.
- Browsers other than Chrome; screen readers / formal WCAG audit.
- Import of real Chrome/Firefox/Edge bookmark exports (parser tested with a hand-written Netscape sample).
- Corporate proxy behaviour of `npm ci`.
- Switching engine has **no automatic migration** by design; only the documented export/import path was verified.

## Release 1.2.0 - documentation site, version display, README workflow

Executed on 2026-10-22 on macOS (Apple silicon) with Node 24.14.0 and 22.23.3, Python 3.14.6 (local) and 3.13 (Docker docs stage), Chrome, Docker 29.8.2, PostgreSQL 17.11 and MySQL 8.4.13 containers.

| Check | Result |
| --- | --- |
| `npm run docs:setup` / `docs:build` in a fresh copy of the repository (no `node_modules`, `dist`, venv, `.env`) | OK; strict build, 0 warnings |
| Strict mode really fails | Verified by injecting each problem: broken internal link, missing anchor, unknown `mkdocs.yml` key, page missing from the navigation - each aborted the build |
| Fresh-checkout **production** path from the README (copy templates, edit `.env`, `npm ci`, `config:check`, `db:migrate`, `build`, `docs:setup`, `docs:build`, `npm start`, URLs, health, restart) | OK; app, `/docs/`, a nested docs page, a docs asset and the search index all HTTP 200; health green; data persisted across restart |
| Fresh-checkout **development** path (`npm run dev`) | OK; `.env` data directory honoured, UI on 5173, API health on 4311, `/docs/` and `/api` proxied through Vite |
| **Docker**: image build including the Python docs stage (Python 3.13) | OK; container healthy; `/docs/`, nested page and the bundled font served; build argument `OPSDESK_COMMIT` appears in the session build info |
| Templates vs loader | `opsdesk.config.example.json` parses (strict JSON) and is accepted by the loader; every variable in `.env.example` is one the application reads and its active lines form a working SQLite configuration; the repo's `.env.example` contains no real secret (unit tests) |
| Missing/invalid configuration | Invalid JSON, unknown key, wrong type, missing file, bad port, non-loopback host, unsupported engine, missing URL: one-line errors with exit code 1 from `npm run config:check` and `npm start`; the database URL/password is never printed, including when a URL is pasted into the wrong variable (found and fixed during this verification) |
| Configuration precedence | environment > `opsdesk.config.json` > defaults (unit test) |
| Version consistency | `/api/health`, `/api/session`, the sidebar footer on workspace selection, a workspace and Settings, and Settings > About all show the `package.json` version (Playwright); no version string exists in any UI component |
| Build metadata | `dist/build-info.json` written by `npm run build`; build time shown; **no commit id is shown in a checkout without git** (verified) and the commit appears when supplied (Docker build argument); a build-info file for another version and malformed values are ignored (unit tests) |
| Collapsed sidebar and a 390 px wide viewport | version text visible, within the sidebar bounds (Playwright) |
| **Documentation link** | The sidebar link has `href="/docs/"`, opens the documentation in a new tab (Playwright) |
| `/docs/` routing | Index, nested pages, direct refresh, `/docs` redirect, assets, 404 for unknown pages; the app's SPA fallback does not hijack `/docs` or `/api`; a documentation build created after the server started is picked up without restart (HTTP tests + Playwright) |
| Docs work offline | Playwright records every request while browsing the documentation (navigation, refresh, search, colour-mode toggle): all go to the local server, none fail, no console errors (a CSP violation would appear there) |
| Unit and HTTP tests, **SQLite + PostgreSQL + MySQL**, Node 24 and Node 22 | 162 passed, 6 skipped (SQLite-file backup tests, not applicable to PostgreSQL/MySQL) |
| Browser tests on SQLite, PostgreSQL, MySQL | 5 of 5 on each (workflow, drag and drop, workspace navigation, version + Documentation link, documentation site) |
| `npm run typecheck`, `npm run build:all` | OK |
| CI workflow | The YAML parses. **It has not been executed**: see below |

### Not verified in 1.2.0

- **CI:** the repository had no CI configuration and no git remote, so no existing platform could be followed. The included GitHub Actions workflow was never run on GitHub; no badge is shown. Its commands are the ones executed locally above.
- **Windows PowerShell / Linux hosts:** command variants are written and consistent with the scripts, but were never executed there. The Python helper's `py` launcher handling is untested.
- **Python versions:** 3.13 and 3.14 only; 3.10-3.12 are expected to work (`scripts/docs.mjs` enforces 3.10+) but were not run.
- **Browsers:** documentation and UI were exercised in Chrome only.
- **Commit id from a real git checkout** was not exercised (this directory is not a git repository); the code path is covered by the environment variable/build-argument route and unit tests.

## Release 1.3.0 - complete HTTP API, authentication, OpenAPI, Swagger, cookbook

Executed on 2026-10-22 on macOS (Apple silicon): Node 24.14, Chrome, `curl` 8.7, `jq`, Docker 29.8, PostgreSQL 17.11 and MySQL 8.4.13 containers.

| Check | Result |
| --- | --- |
| Unit, HTTP API, contract, auth, OpenAPI and cookbook tests on **SQLite + PostgreSQL + MySQL** | **224 passed**, 6 skipped (SQLite-file backup tests that do not apply to the other engines) |
| Same suites on SQLite only | 112 passed, 1 skipped |
| Browser tests (Playwright, Chrome), **SQLite, PostgreSQL, MySQL** | **7 of 7 on each** (UI workflow, drag and drop, navigation, version, docs site, **Swagger under `/docs/`**, **Swagger standalone preview with CORS**) |
| `npm run typecheck`, `npm run build:all`, strict MkDocs build | OK |
| Docker (`docker compose up --build` with `OPSDESK_API_TOKEN`) | healthy; bearer create/delete over `http://127.0.0.1` works; anonymous POST is `401`; `/docs/api/reference/`, the Swagger bundle and `docs/api/openapi.json` are served; **the live `/api/v1/openapi.json` equals the copy shipped in the docs**; the token is not in the container log or image history |

### Requested verification items

| Item | Evidence |
| --- | --- |
| API coverage for every inventoried UI operation | `docs/api/coverage.md` is generated from `server/api/coverage.ts`; a test fails if any mapped operation does not exist or any endpoint is not accounted for. `api-v1.test.ts` calls **every one of the 43 operations** (a final test asserts the set of exercised operationIds equals the set of routes) on each engine |
| Complete curl-based CRUD workflow | `docs/api/examples/cookbook.sh` (curl + jq) runs health, create workspace/group/bookmark, read, search, edit, favorite, duplicate, move, reorder, ETag/If-Match, Idempotency-Key, recent, settings, export, import preview/merge/HTML/replace, backups, error inspection and cleanup against a **running server**, and the test asserts the dashboard is identical afterwards. Passed on SQLite, PostgreSQL and MySQL |
| Authentication failures and success | `auth.test.ts`: no token configured (reads work, every change `401 authentication_required`, bearer `401 api_auth_not_configured`); wrong token `401 invalid_token`; malformed header; correct token works **without Origin, CSRF or Content-Type**; throttling after 20 failures (`429`); constant-time comparison |
| Origin, Host, CORS, CSRF | foreign Origin with token `403`; exact configured origin gets `Access-Control-Allow-Origin: <that origin>` (never `*`), pre-flight `204`; unlisted origin `405`/`403`; anonymous cross-origin read refused; foreign `Host` `403`; token over HTTP to a non-local host name `403 https_required` (and `X-Forwarded-Proto` honoured only with `OPSDESK_TRUST_PROXY=1`); UI CSRF path unchanged |
| UI keeps working | UI-style requests (same-origin, CSRF) pass with and without a token configured; the 7 browser tests pass on all engines. **A regression was found and fixed during this verification**: the Settings backups list expected a bare array and crashed the UI when `GET /backups` became a paginated envelope |
| Validation and consistent errors | every error is `{error:{code,message,fields?,requestId}}`; field-level validation, JSON syntax, size limits (`413`), unsafe URLs, `limit` bounds; `X-Request-Id` on every response, client ids honoured if well-formed |
| Pagination, filters, search | page boundaries (disjoint, complete, `hasMore`), search terms, scope (workspace vs all), environment (any) / tag (all) / favorite filters, sorting incl. null handling |
| Transactional moves and reorders | dense positions after moves; a failing move (`404`) changes nothing; non-empty group/workspace delete refused with `409` and unchanged, then `mode=move` / `mode=delete` (body or query) |
| Lost-update protection and retries | `If-Match` success, stale `412` without modification (PATCH, move, DELETE), `*`; unrelated child changes do not invalidate the parent validator; `Idempotency-Key` replay, `422` on key reuse with another body |
| Import preview without mutation; invalid import rollback; protected replace and backup | preview leaves the dashboard byte-identical and creates no backup; invalid/unsupported documents rejected (`400`) with data unchanged; failure injected halfway through a valid replace rolls back completely; replace without `confirmReplace` is `400` and creates no backup; with the flag a backup exists and is named in the response; multipart JSON and HTML uploads, oversize `413`, multipart refused without a token |
| GET never mutates | every GET endpoint (including `/export`, `/recent`, `/bookmarks/{id}`, `/health`) called, dashboard compared before and after |
| OpenAPI validation and contract consistency | the generated document validates as OpenAPI 3.1 (`@seriousme/openapi-schema-validator`); the mounted Express routes equal the documented operations; unique operationIds, resolvable `$ref`s, declared path parameters, security per class; **every response in the tour is validated against the documented JSON Schema with Ajv**; `docs/api/openapi.json` and `coverage.md` must equal freshly generated output |
| Strict MkDocs build | passes; includes embedded cookbook snippets (`pymdownx.snippets` with `check_paths`) |
| Swagger assets, spec loading, authorization, Try it out under `/docs/` | Playwright: vendored bundle served locally (identical to `swagger-ui-dist`), spec loaded from `/api/v1/openapi.json`, **no API request before Execute**, `persistAuthorization:false` and no validator URL, unauthenticated Try it out `401`, Authorize with an empty field then `201` (the created workspace is verified through the API), token absent from `localStorage`/`sessionStorage`/cookies, unauthorized again after reload, destructive operations marked (⚠, red), direct refresh of `/docs/api/reference/` and `/docs/api/cookbook/`, **no external requests**, no console errors other than the browser's note on the deliberate 401 |
| Standalone preview | a separate origin (`http://127.0.0.1:4399`, like `mkdocs serve`) uses the bundled spec, the API-server form, the exact-origin CORS allowlist and the token: Try it out returns `200` |
| No secrets in generated docs or frontend assets | tokens and test credentials searched in `dist/web`, `dist/docs`, `docs/`, README and templates: none; the OpenAPI document contains only reserved example domains and no token-like strings (tests) |

### Not verified in 1.3.0

- **`docs/api/examples/cookbook.ps1` (PowerShell) was never executed**: PowerShell is not available in the test environment. It mirrors `cookbook.sh`; treat it as untested. Windows `curl.exe` quoting and `-H @file` behaviour were not checked.
- Linux and Windows hosts; browsers other than Chrome.
- The GitHub Actions workflow (see 1.2.0) has not run on a real remote; it does not yet run the cookbook, Swagger or API contract suites on PostgreSQL/MySQL beyond `npm test` in its `databases` job (which includes them when the service containers are present).
- HTTPS itself (TLS termination) was not exercised end to end; the HTTPS requirement was tested through the `Host` and `X-Forwarded-Proto` rules only.
- Behaviour behind a real reverse proxy, very large dashboards (20 000 bookmarks) and concurrent multi-client load.
