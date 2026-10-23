# Repository structure

```
.env.example                  safe template for .env (tracked)
opsdesk.config.example.json   safe template for opsdesk.config.json (tracked)
package.json, package-lock.json   application metadata, the release version, npm scripts, lockfile
mkdocs.yml, requirements-docs.txt documentation site configuration and pinned Python packages
Dockerfile, docker-compose*.yml   optional container deployment (SQLite default, PostgreSQL/MySQL overrides)
.github/workflows/ci.yml          CI definition (GitHub Actions; see "Documentation toolchain")

server/                       Express API, domain logic, health, import/export, backups (TypeScript)
  api/                        HTTP API: route registry (the single source of truth), OpenAPI generator, coverage map
  db/                         SQLite / PostgreSQL / MySQL drivers, migrations, the Executor interface
  auth.ts                     bearer-token / UI-session authentication, request ids, idempotency
  cli/                        config:check and db:migrate commands
  tests/                      vitest unit and HTTP API tests (SQLite; PostgreSQL/MySQL when configured)
shared/                       types, constants, URL validation and search logic used by server and web
web/                          React app (Vite root); builds to dist/web
docs/                         this documentation (Markdown sources, assets)
  api/                        API reference pages, GENERATED openapi.json and coverage.md, tested cookbook scripts
  assets/swagger/             vendored Swagger UI + loader (no CDN)
scripts/                      dev launcher, clean, build-info, docs toolchain, backup/restore CLIs, archive, e2e server
e2e/                          Playwright end-to-end tests

dist/                         GENERATED - never edit or commit
  server/, shared/            compiled backend            (npm run build)
  web/                        compiled frontend           (npm run build)
  build-info.json             version, build time, commit (npm run build)
  docs/                       built documentation         (npm run docs:build)
.venv-docs/                   GENERATED - Python virtual environment for the docs
.dev-data/                    GENERATED - development database
<data dir>/                   USER DATA, outside the repository by default
```

## npm scripts

| Script | Purpose |
| --- | --- |
| `dev` | API (tsx watch) + Vite dev server |
| `build` | Clean generated app output, compile server, build frontend, write `dist/build-info.json` |
| `api:spec` | Regenerate `docs/api/openapi.json` and `docs/api/coverage.md` from the route definitions (also run by `docs:build`, `docs:serve` and `npm version`) |
| `docs:vendor` | Refresh the vendored Swagger UI assets from `node_modules` |
| `token:generate` | Print a random API token |
| `docs:setup` / `docs:build` / `docs:serve` | Create `.venv-docs` and install pinned packages / strict build into `dist/docs` / live preview |
| `build:all` | `build` then `docs:build` |
| `start` | Run the built server (loads `.env` if present) |
| `config:check` / `db:migrate` | Validate configuration / apply migrations separately |
| `backup` / `restore` | SQLite file backup and restore |
| `typecheck`, `test`, `test:e2e` | Quality checks |
| `archive` | Distribution archives in `release/` |
