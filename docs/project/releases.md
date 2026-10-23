# Releases and versioning

## One version, one place

The release version is the `version` field of **`package.json`** (mirrored by `package-lock.json`). It follows [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`. There is no other version string to maintain:

| Where the version appears | How it gets there |
| --- | --- |
| `GET /api/health` (`version`) and `GET /api/session` (`version`) | Read from `package.json` by `server/version.ts` when the server starts |
| Sidebar footer (`OpsDesk · v1.2.0`) and **Settings > About** | Taken from `/api/session`; no version is hardcoded in any UI component |
| `dist/build-info.json` (build time, commit id) | Written by `scripts/build-info.mjs` at the end of `npm run build`; carries the version it was built for and is ignored if it does not match |
| Distribution archives (`release/opsdesk-X.Y.Z.*`) | `npm run archive` reads `package.json` |
| Docker image | The image contains `package.json`; the Compose image tag is the fixed `opsdesk:local` |

Build date and commit id appear in Settings > About **only when they exist**: a built run has a build time; the commit id appears when the build ran in a git checkout, or `OPSDESK_COMMIT` was supplied (Docker: `--build-arg OPSDESK_COMMIT=...`). The development server shows neither.

!!! info "No release automation exists in this repository"
    The repository contains no release workflow, changelog generator or tagging tool. The procedure below uses only npm's built-in `npm version`; if you later add automation, make it call the same command rather than editing version numbers by hand.

## Choosing the next version

| Change | Bump |
| --- | --- |
| Backwards-compatible fixes | `patch` |
| New features, new optional settings, new documentation, new database support | `minor` |
| Breaking changes (removed settings, incompatible schema without upgrade path) | `major` |

## Release procedure

All commands run in the **repository root**, on a clean working tree.

1. **Verify the baseline**

    ```bash
    npm ci
    npm run typecheck
    npm test
    ```

2. **Bump the version** - this is the only place the number is edited (the `version` npm script also regenerates `docs/api/openapi.json`, which embeds the release number):

    === "Inside a git repository"

        ```bash
        npm version minor -m "Release v%s"      # edits package.json + package-lock.json, commits, tags v<version>
        ```

    === "Without git (or to skip the commit and tag)"

        ```bash
        npm version minor --no-git-tag-version  # edits package.json + package-lock.json only
        ```

    Use `patch` or `major` as appropriate, or an explicit version such as `npm version 1.3.0`.

3. **Add release notes** below (newest first) and, if the schema changed, check [Migrations](../operations/migrations.md).

4. **Build everything**

    ```bash
    npm run build:all        # app + build-info + strict documentation build
    npm run test:e2e         # browser tests against the production build
    ```

5. **Verify the version end to end**

    ```bash
    npm start
    curl http://127.0.0.1:4310/api/health      # "version" must equal package.json
    ```

    The same value must be visible in the sidebar footer and in Settings > About; Settings > About also shows the build time (and the commit when available).

6. **Package**

    ```bash
    npm run archive                    # release/opsdesk-<version>.zip and .tar.gz (no node_modules, dist or user data)
    docker compose build               # optional: image with the same version baked in
    ```

7. **Publish internally.** With git: `git push --follow-tags`. Distribute the archive or image through your own channels; nothing in this repository publishes anywhere by itself.

### Deploying a release

[Production](../guides/production.md): back up, replace the sources, `npm ci`, `npm run build:all`, **restart**. Migrations apply automatically at start-up ([Migrations](../operations/migrations.md)).

## Release notes

### 1.3.0

- **Complete HTTP API under `/api/v1`** covering every UI operation, plus listing/search with pagination and sorting, tags, environments, recent history (list, record, clear), settings and capabilities; documented coverage table.
- **Bearer-token authentication** for curl/scripts (`OPSDESK_API_TOKEN`), exact-origin CORS allowlist, request ids, `If-Match`/ETag lost-update protection and `Idempotency-Key` retries; creates now return `201`.
- **OpenAPI 3.1 contract** generated from the route definitions, served at `/api/v1/openapi.json` and shipped in the docs; **interactive Swagger UI** (bundled, offline) in the documentation.
- Tested **curl cookbook** (POSIX shell; PowerShell version provided but not executed in CI), multipart import upload.
- **Compatibility notes:** `GET /backups` now returns a paginated envelope `{items, page}` instead of a bare array; creating returns `201` instead of `200`; mutations from clients that send no `Origin` and no CSRF token now get `401` instead of `403`. The bundled UI was updated accordingly.
- `npm run api:spec`, `docs:vendor`, `token:generate`; `npm version` regenerates the committed contract.

### 1.2.0

- Documentation site (MkDocs Material) in the repository, built into `dist/docs` and served at `/docs/` by the application; **Documentation** link in the sidebar and Settings.
- Release version in the sidebar footer and **Settings > About**, from the single `package.json` version; genuine build metadata (build time, commit) when available.
- New commands `npm run config:check`, `npm run db:migrate`, `npm run docs:setup|build|serve`, `npm run build:all`.
- `npm run dev` now also loads `.env`.
- README rewritten as a step-by-step entry point; GitHub Actions workflow for build, tests and strict documentation build (unverified until run on your remote).

### 1.1.0

- PostgreSQL and MySQL support next to SQLite (explicit start-up configuration), `schema_migrations` on every engine.
- `/api/health` with green/yellow/red status and HTTP 200/503.
- Workspace selection screen with the logo/product name as link, client-side router.

### 1.0.0

- First release: workspaces, groups, bookmarks, search, command palette, JSON/HTML import, SQLite backups.
