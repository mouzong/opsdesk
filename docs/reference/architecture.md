# Architecture

## Goals that shaped the design

Single user, localhost, works offline on a locked-down laptop, easy to back up, no infrastructure beyond Node. Every choice below favours "boring and inspectable".

## Components

```
Browser (React SPA)  --JSON/HTTP-->  Express (server/app.ts)  --Executor-->  SQLite (node:sqlite) | PostgreSQL (pg) | MySQL (mysql2)
        ^                                  |
        |  static files (dist/web)         +-- backups/*.sqlite (SQLite) or pre-import-*.json (PostgreSQL/MySQL)
        +----------------------------------+
```

| Layer | Files | Responsibility |
| --- | --- | --- |
| Config | `server/config.ts` | JSON file + environment variables; refuses non-loopback binding unless `allowNetwork`. |
| Storage | `server/db/*` | One async `Executor` interface (`query`, `run`, `exec`, re-entrant `transaction(fn, {rollback})`) with three drivers: `sqlite.ts` (FIFO queue + `BEGIN IMMEDIATE`, `foreign_keys=ON`, `busy_timeout`, `journal_mode=DELETE`), `postgres.ts` (`pg` pool), `mysql.ts` (`mysql2` pool). Per-engine DDL in `migrations.ts`, version history in a `schema_migrations` table on every engine (`migrate.ts`; legacy SQLite `user_version` databases are adopted). Drivers for PostgreSQL/MySQL are imported lazily. |
| Domain | `server/repo.ts` | All CRUD, ordering and move/delete rules, written once in portable SQL (`?` placeholders, `"quoted"` identifiers adapted per driver). Every public function is one transaction. |
| Health | `server/health.ts` | Bounded, cached checks (database read + rolled-back write probe, directory writability, migrations) -> green/yellow/red, HTTP 200/503. |
| Import/export | `server/importExport.ts`, `server/netscape.ts` | Zod-validated export format, exact preview (real import + rollback), merge/replace, Netscape HTML tokenising with `htmlparser2` (data only, never rendered). |
| Backups | `server/backup.ts` | SQLite only: `VACUUM INTO` snapshots, retention, integrity-checked restore with safety copy. PostgreSQL/MySQL: JSON safety export before imports; native tools for real backups. |
| Security | `server/security.ts` | Host allow-list, Origin/Host equality, CSRF token, content-type, `Sec-Fetch-Site`, CSP and other headers. |
| HTTP | `server/app.ts`, `server/validation.ts` | Routes, body limits, input validation (zod), uniform JSON errors. |
| Shared | `shared/*` | Types, limits, icon names, URL validation, search/filter logic (single source of truth for client and server tests). |
| API | `server/api/*`, `server/auth.ts` | Every operation is declared once in `routes.ts` (path, method, validators, auth class, idempotency, handler). `mount.ts` builds the Express router from that list (validation, If-Match transaction, idempotency replay, multipart), and `openapi.ts` generates the OpenAPI 3.1 document from the same definitions and zod validators, so spec and behaviour cannot drift. See [API quick start](../api/index.md). |
| Docs | `mkdocs.yml`, `docs/`, `scripts/docs.mjs` | MkDocs Material site, built to `dist/docs` and served by `server/app.ts` under `/docs/` (static, own CSP, excluded from the SPA fallback). See [Documentation toolchain](../project/documentation.md). |
| Version | `server/version.ts`, `scripts/build-info.mjs` | The version is read from `package.json` (single source). `dist/build-info.json` adds the real build time and commit id when available; a file for another version is ignored. The UI reads both from `/api/session`. |
| UI | `web/src/*` | React 19 SPA: `router.tsx` (History-API router: `/`, `/w/:id`, `/settings`), `store.tsx` (state + actions), `components/*`, plain CSS with design tokens. |

## Key decisions

0. **Three engines behind one interface, portable SQL instead of an ORM.** Values are stored identically everywhere (booleans `0/1`, ISO-8601 text timestamps, JSON text for tags, UUID text ids), so one set of statements works on SQLite, PostgreSQL and MySQL; only DDL, the meta upsert and driver placeholder syntax differ. The engine is a start-up setting; there is no runtime switching and no automatic data copy (the portable JSON export is the transfer path). External engines serialise write transactions in-process (a real concurrency test on PostgreSQL/MySQL proved this necessary for position bookkeeping); run one instance per database.

1. **`node:sqlite` instead of a native addon (for the default engine).** Removes the compiler/prebuilt-binary problem on corporate machines. Cost: requires Node ≥ 22.13, API is still flagged experimental. Mitigation: all SQL access goes through `server/db.ts` and `server/repo.ts`.
2. **One SQLite file, rollback journal (not WAL).** A backup or move is "copy one file" (when stopped) and there are no `-wal`/`-shm` companions to forget; also friendlier to Docker bind mounts. Online backups use `VACUUM INTO`, which is transactionally consistent.
3. **The server returns the whole dashboard tree; the client filters.** At the intended scale (hundreds to a few thousand bookmarks, hard limit 20 000) this makes search instantaneous and keeps the search rules in one tested module (`shared/search.ts`). After each mutation the client refetches, so the UI always shows database truth.
4. **IDs are UUIDs; ordering is a dense integer `position` per parent**, renumbered inside the same transaction as a move. Moves are expressed as "put X at index N of parent P", which serves drag and drop and the keyboard menu equally.
5. **Import identity is by name/URL, not by ID**, so exports can be merged between machines. Preview = real import inside a transaction that is always rolled back, so it cannot drift from what Apply does.
6. **Sample data is flagged per row (`is_sample`).** Editing or moving an item clears its flag, so "Remove sample data" never deletes user work. `meta.setup = 'done'` makes the first-run choice one-time.
7. **CSRF without sessions:** a random token generated per server process is returned by `GET /api/session`. No CORS means other origins cannot read it; Origin/Host/Sec-Fetch checks and the JSON-only content type add independent layers.
8. **Plain CSS and a handful of dependencies** (express, zod, htmlparser2, react, lucide-react, fontsource). No UI framework, router or state library.

## Data model (schema version 2)

```
schema_migrations(version, name, applied_at)   same on every engine
health_probe(id, created_at)             only ever written inside a rolled-back transaction
meta(key, value)                         title, setup
workspaces(id, name, icon, position, is_sample, created_at, updated_at)
bookmark_groups(id, workspace_id -> workspaces ON DELETE CASCADE, name, position, collapsed, is_sample, ...)
bookmarks(id, group_id -> bookmark_groups ON DELETE CASCADE, title, url, description, environment CHECK(...),
          owner, icon, tags JSON, favorite, note, is_sample, position, created_at, updated_at,
          last_opened_at, open_count)
```

Add a new migration (with statements for all three dialects) to `MIGRATIONS` for any schema change; never edit a shipped one. A database whose highest applied version is newer than the build supports is refused.

## HTTP API (all under `/api`, JSON)

`GET /health` (200/503, see [Health endpoint](../operations/health.md)), `GET /session`, `GET /dashboard`, `PATCH /settings`, `POST /setup`, `POST /sample-data/remove`,
`POST /workspaces`, `PATCH|DELETE /workspaces/:id`, `POST /workspaces/:id/move`, `POST /workspaces/:id/groups`,
`PATCH|DELETE /groups/:id`, `POST /groups/:id/move`, `POST /groups/:id/bookmarks`,
`PATCH|DELETE /bookmarks/:id`, `POST /bookmarks/:id/{move,duplicate,opened}`,
`GET /export`, `POST /import/{preview,apply}`,
`GET|POST /backups`, `GET /backups/:name/download`, `POST /backups/:name/restore`, `DELETE /backups/:name`.

Mutating calls need `Content-Type: application/json`, `X-CSRF-Token` and a same-origin `Origin`.

## Frontend routing

No router existed in 1.0.0 (a `view` state switched screens). 1.1.0 adds `web/src/router.tsx`: `pushState` navigation, `popstate`/`useSyncExternalStore` subscription, and a `Link` component that renders a real anchor and intercepts only plain left-clicks. The server answers any non-API path with `index.html`, so deep links and reloads work. The selected workspace is a preference that changes only when a workspace route is opened; visiting `/` or `/settings` never changes it.

## Extension points (not built, by design)

- New bookmark fields: migration + `repo.ts` mapper + `bookmarkShape` in `validation.ts` + the export schema (bump `EXPORT_VERSION` only for breaking changes).
- Another storage engine: add a driver implementing `Executor` in `server/db/`, DDL in `migrations.ts`, and add it to `DbClient` in `config.ts`.
- Authentication or multi-user: would sit in front of `apiGuard`; the data model would need a user/owner column. Not included.
- Optional status checks or favicon fetching would need an explicit, opt-in, separately reviewed server module; the current code contains no outbound HTTP at all.
