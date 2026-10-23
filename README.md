# OpsDesk

A **local, offline infrastructure bookmarks dashboard**: workspaces, groups and cards for the URLs you need during daily operations and incidents, with fast search, a command palette, portable JSON export/import and backups. Single user, runs on `127.0.0.1`, no cloud services, no accounts, no telemetry.

| | |
| --- | --- |
| **Release** | `1.3.0` (the `version` in [package.json](package.json); also shown in the app's sidebar and in `/api/health`) |
| **Node.js** | **22.13 or newer** (22 LTS or 24 LTS; tested with 22.23 and 24.14) |
| **Package manager** | **npm 10 or newer** (tested with 11.12); lockfile `package-lock.json`, install with `npm ci` |
| **Python** | **3.10 or newer, only for building the documentation** (tested with 3.13 and 3.14); the application itself does not use Python |
| **Databases** | SQLite (default, built into Node), PostgreSQL 13+ (tested 17.11), MySQL 8.0.16+ (tested 8.4.13) |
| **Stack** | TypeScript 5.9 - React 19 + Vite 8 (frontend) - Express 5, zod 4, htmlparser2 (backend) - `node:sqlite`, `pg` 8, `mysql2` 3 (storage) - lucide-react icons, Inter font bundled locally - vitest 5 + Playwright (tests) - MkDocs 1.6 + Material 9.7 (documentation) |
| **CI** | A GitHub Actions workflow is included ([.github/workflows/ci.yml](.github/workflows/ci.yml)); **no status badge is shown because this checkout has no git remote and the workflow has not run on a real one.** See [CI status](#ci-status). |

**Jump to:** 
- [Configure (start here)](#1-configure-first) 
- [Development](#2-development-path) 
- [Production](#3-production-path) 
- [Docker Compose](#4-docker-compose-path) 
- [Troubleshooting](#troubleshooting) 
- Documentation: `docs/` in this repository, served by the app at **`/docs/`** once built (start with [docs/index.md](docs/index.md)).

> All commands below run in the **repository root** (the folder that contains `package.json`) unless a step says otherwise. Windows users: use **PowerShell**; if it refuses to run `npm` ("running scripts is disabled") write `npm.cmd` instead.

---

## 1. Configure first

Creating the two local configuration files is the **first setup step** for every path below.

| File | Holds | In git? |
| --- | --- | --- |
| `.env` | environment variables, including **secrets** (database URL) | no - ignored; template `.env.example` is tracked |
| `opsdesk.config.json` | non-secret settings | no - ignored; template `opsdesk.config.example.json` is tracked |

Both belong in the repository root, next to `package.json`. Copy the templates:

**macOS / Linux**

```bash
cp .env.example .env
cp opsdesk.config.example.json opsdesk.config.json
```

**Windows PowerShell**

```powershell
Copy-Item .env.example .env
Copy-Item opsdesk.config.example.json opsdesk.config.json
```

Then edit them in your editor.

- **Mandatory values:** none for SQLite. The copied templates already are a working configuration (port 4310, SQLite, data in a per-user folder). For **PostgreSQL/MySQL** `OPSDESK_DB_CLIENT` and `OPSDESK_DATABASE_URL` are mandatory.
- **Minimum working SQLite configuration** (everything else is optional):

  ```ini
  # .env
  OPSDESK_PORT=4310
  OPSDESK_DB_CLIENT=sqlite
  ```

  ```json
  { "host": "127.0.0.1", "port": 4310 }
  ```
- **Which file for what:** put **secrets and deployment values** (database URL, TLS file paths, ports, data directory) in `.env`; put **non-secret defaults** (`host`, `port`, `dataDir`, `allowNetwork`, `allowedHosts`, `autoBackupKeep`, the `database` block without URL) in `opsdesk.config.json`. The URL is rejected in the JSON file on purpose.
- **Precedence:** environment variable (including values from `.env`; a variable already set in your shell wins over `.env`) **>** `opsdesk.config.json` **>** built-in default.
- **Restart required:** configuration is read once at start-up. Restart after every change.
- **JSON does not support comments** (and no trailing commas); unknown keys are rejected with an error. The explanations live in `.env.example` and the [configuration reference](docs/getting-started/configuration.md).
- **Optional file location:** `OPSDESK_CONFIG=/path/file.json` points to a different config file (it must then exist).

Check your files (needs the dependencies from the next step; run it again after installing):

```bash
npm run config:check
```

It prints the effective, non-secret settings or a sanitized error (never the database URL or password).

---

## 2. Development path

Prerequisite: [step 1](#1-configure-first) is done.

1. **Verify prerequisites**

   ```bash
   node -v     # v22.13.0 or higher
   npm -v      # 10 or higher
   ```

2. **Install dependencies** (installs exactly what `package-lock.json` pins)

   ```bash
   npm ci
   ```

3. **Data directory:** nothing to create. In development it is `.dev-data/` (or `OPSDESK_DATA_DIR` from `.env`) and is created automatically. Note: `npm run dev` always runs the API on port **4311** and ignores `OPSDESK_PORT`/`port` and the `dataDir` key of the JSON file.

4. **Database initialisation / migrations:** they run **automatically** when the server starts. To run them (and see any problem) beforehand:

   ```bash
   npm run config:check
   OPSDESK_DATA_DIR=.dev-data npm run db:migrate      # PowerShell: $env:OPSDESK_DATA_DIR = ".dev-data"; npm run db:migrate
   ```

5. **Start development mode** (API with auto-restart + Vite with hot reload)

   ```bash
   npm run dev
   ```

6. **Open the app:** <http://localhost:5173> (the API listens on `127.0.0.1:4311`; the UI proxies `/api` and `/docs`).

7. **Verify health**

   ```bash
   curl http://127.0.0.1:4311/api/health          # PowerShell: Invoke-RestMethod http://127.0.0.1:4311/api/health
   ```

   Expect `"status": "green"` and `"version": "1.3.0"`; the same version is shown at the bottom of the sidebar.

8. **Stop and restart:** press `Ctrl+C`, then run `npm run dev` again - your data persists in `.dev-data/`.

Preview the documentation while writing it: `npm run docs:setup` once, then `npm run docs:serve` -> <http://127.0.0.1:8000> (needs [Python](#python-for-the-documentation)).

---

## 3. Production path

Prerequisite: [step 1](#1-configure-first) is done. One process serves the API, the app and the documentation from one address. No Docker, administrator rights or internet access are needed after installation.

1. **Configuration:** step 1. For production set at least the port and (optionally) the data directory in `.env`; for PostgreSQL/MySQL also the engine and URL ([databases](docs/operations/databases.md)).

2. **Verify prerequisites:** `node -v` (>= 22.13), `npm -v` (>= 10); `python3 --version` / `py --version` (>= 3.10) **only for the documentation**.

3. **Install dependencies**

   ```bash
   npm ci
   ```

4. **Database preparation.** SQLite: the data directory and file are created for you. PostgreSQL/MySQL: create the empty database and account first ([server setup](docs/operations/databases.md#server-setup)). Migrations run **automatically at every start**; to run them now:

   ```bash
   npm run config:check
   npm run db:migrate
   ```

5. **Build the application**

   ```bash
   npm run build
   ```

6. **Build the documentation** (Python is needed only here)

   ```bash
   npm run docs:setup     # once: creates .venv-docs and installs the pinned MkDocs packages
   npm run docs:build     # strict build into dist/docs
   ```

   Steps 5 and 6 in one go after the first setup: `npm run build:all`.

7. **Start**

   ```bash
   npm start
   ```

8. **URLs**
   - Application: <http://127.0.0.1:4310/> (your configured port)
   - Documentation: <http://127.0.0.1:4310/docs/>
   - Health: <http://127.0.0.1:4310/api/health>
   - Documentation URLs:
      - Interactive reference: http://127.0.0.1:4310/docs/api/reference/
      - API quick start: http://127.0.0.1:4310/docs/api/
      - Authentication: http://127.0.0.1:4310/docs/api/authentication/
      - curl cookbook: http://127.0.0.1:4310/docs/api/cookbook/
      - Machine-readable contract: http://127.0.0.1:4310/api/v1/openapi.json

9. **Verify health:** `curl http://127.0.0.1:4310/api/health` -> HTTP 200, `"status": "green"`, `version` equal to the one in the sidebar and **Settings > About** ([field reference](docs/operations/health.md)).

10. **Verify persistence:** add a bookmark, `Ctrl+C`, `npm start` again: it is still there. Back up before upgrades ([backup and restore](docs/operations/backup-restore.md)).

After changing `package.json` (a new version) or pulling new sources: `npm ci`, `npm run build:all`, **restart** - the version is read when the server starts.

---

## 4. Docker Compose path

Optional; the default needs no external database. Prerequisite: Docker with Compose v2.

1. **Configuration:** copy the template ([step 1](#1-configure-first)); only `.env` matters here.

   ```bash
   cp .env.example .env            # PowerShell: Copy-Item .env.example .env
   ```

   Compose uses `.env` to substitute variables in the compose files (it never goes into the image). Default SQLite: optionally set `OPSDESK_PORT` (the **host** port). For PostgreSQL/MySQL set `POSTGRES_PASSWORD` or `MYSQL_PASSWORD` + `MYSQL_ROOT_PASSWORD` (`openssl rand -hex 24`).

2. **Verify prerequisites:** `docker --version`, `docker compose version`.

3. **Data directory and migrations:** automatic - `/data` is a named volume and migrations run when the container starts. (The image also builds this documentation in a Python stage; no Python is needed on your machine.)

4. **Build and start** (only the services you name start)

   ```bash
   docker compose up -d --build                                                          # SQLite (default)
   docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build    # + PostgreSQL 17
   docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d --build       # + MySQL 8.4
   ```

5. **URLs:** application <http://127.0.0.1:4310/>, documentation <http://127.0.0.1:4310/docs/> (loopback only).

6. **Verify health:** `docker compose ps` shows `healthy`; `curl http://127.0.0.1:4310/api/health`.

7. **Persistence and restart:** `docker compose restart opsdesk` keeps data; `docker compose down` keeps the volumes; `down -v` deletes them.

Details: [Docker Compose guide](docs/guides/docker.md).

---

## CLI / HTTP API quick start

Everything the UI can do is available over HTTP (`/api/v1`) for curl and scripts, described by an OpenAPI 3.1 document with an interactive Swagger UI in the documentation.

1. **Enable token access** (once): generate a token, put it in `.env`, restart. Changes without a token are refused.

   ```bash
   npm run token:generate                          # prints a random token
   echo 'OPSDESK_API_TOKEN=<paste the token>' >> .env       # PowerShell: Add-Content .env 'OPSDESK_API_TOKEN=<paste the token>'
   npm start
   ```

2. **Call it** (the token comes from the environment and a private header file; never type it into a command line):

   ```bash
   export BASE=http://127.0.0.1:4310/api/v1
   read -rs OPSDESK_API_TOKEN && export OPSDESK_API_TOKEN
   printf 'Authorization: Bearer %s\n' "$OPSDESK_API_TOKEN" > /tmp/od-auth && chmod 600 /tmp/od-auth
   curl -s "$BASE/health" | jq .status                                  # no token needed
   curl -s -X POST "$BASE/workspaces" -H @/tmp/od-auth -H 'Content-Type: application/json' -d '{"name":"Observability"}' | jq .id
   ```

   PowerShell uses `curl.exe` and body files: see the cookbook.

- **Full walkthrough of every operation** (shell and PowerShell): [curl cookbook](docs/api/cookbook.md) - runnable script [docs/api/examples/cookbook.sh](docs/api/examples/cookbook.sh) (`bash docs/api/examples/cookbook.sh`, needs `curl` and `jq`, use a scratch server).
- **Interactive Swagger reference:** <http://127.0.0.1:4310/docs/api/reference/> (after `npm run docs:build`); machine-readable contract: `GET /api/v1/openapi.json`.
- More: [API quick start](docs/api/index.md) - [Authentication](docs/api/authentication.md) - [Pagination and filtering](docs/api/pagination-filtering.md) - [Import and export](docs/api/import-export.md) - [Errors](docs/api/errors.md) - [UI-to-API coverage table](docs/api/coverage.md).

Engine selection, database credentials, the token, CORS settings and file paths are deployment settings and are deliberately **not** reachable through the API.

## Python for the documentation

Python is required **only** for the documentation toolchain (MkDocs); the application is pure Node.js. Commands (repository root):

```bash
npm run docs:setup     # creates .venv-docs and installs requirements-docs.txt (pinned)
npm run docs:serve     # live preview on http://127.0.0.1:8000
npm run docs:build     # strict build -> dist/docs (served by the app at /docs/)
```

Manual equivalents (macOS/Linux: `python3 -m venv .venv-docs && . .venv-docs/bin/activate && pip install -r requirements-docs.txt && mkdocs build --strict`; PowerShell: `py -m venv .venv-docs; .\.venv-docs\Scripts\Activate.ps1; pip install -r requirements-docs.txt; mkdocs build --strict`) are described in [Documentation toolchain](docs/project/documentation.md).

## Releases and the version shown in the UI

The version lives in exactly one place, `package.json`. `/api/health`, `/api/session`, the sidebar footer (`OpsDesk · v1.3.0`), **Settings > About**, the archive names and the Docker image all derive from it. Settings > About shows build time and commit id only when the build really recorded them. To release: `npm version minor` (or `patch`/`major`; add `--no-git-tag-version` outside git), `npm run build:all`, test, `npm run archive`. Full procedure: [Releases and versioning](docs/project/releases.md).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| **Missing or invalid configuration:** `Configuration file ... is not valid JSON` / `is invalid` / `Invalid port` / `Unsupported database client` / `requires OPSDESK_DATABASE_URL` | Compare with the `*.example` templates (no comments or trailing commas in JSON, no unknown keys, port 1-65535, PostgreSQL/MySQL need the URL). `npm run config:check` prints the effective values. Changes need a restart. |
| **Unsupported Node.js:** `No such built-in module: node:sqlite` or an `engines` warning | Install Node.js 22.13+ (`node -v`). |
| **Unsupported Python** (docs only): `Python 3.10 or newer is required` / `No suitable Python found` | Install Python 3.10+ and run `npm run docs:setup` again. The application does not need Python. |
| **Port already in use:** `Port 4310 is already in use` | Set another `OPSDESK_PORT`, or find the process: `lsof -i :4310` (macOS/Linux), `Get-NetTCPConnection -LocalPort 4310` (PowerShell). |
| **Data directory not writable:** `EACCES`, `EPERM`, `unable to open database file`, health `data_directory_writable: false` | Set `OPSDESK_DATA_DIR` to a folder you own (not read-only or synced network storage). |
| **Database connection or migration failure:** `Could not connect to the PostgreSQL/MySQL database (CODE)`, `Database migration failed` | Use the error code (`ECONNREFUSED` network, `28P01`/`ER_ACCESS_DENIED_ERROR` credentials, certificate codes -> `OPSDESK_DB_SSL_CA_FILE`). The account needs permission to create tables. OpsDesk never falls back to SQLite. Retry with `npm run db:migrate`. |
| **Documentation build missing:** `/docs/` says it "has not been built" | `npm run docs:setup` (once), then `npm run docs:build`, reload - no restart needed. `npm run build` does not build the docs. |
| **Application version not updating after a build** | The server reads `package.json` at start-up: **restart** it, make sure `npm run build` ran (it rewrites `dist/build-info.json`; a file from another version is ignored), hard-reload the browser; Docker: `docker compose up -d --build`. Compare `curl .../api/health` with `package.json`. |

More: [Troubleshooting](docs/operations/troubleshooting.md).

## CI status

The repository was delivered without CI configuration and without a git remote, so there is **no verified CI badge**. [.github/workflows/ci.yml](.github/workflows/ci.yml) defines jobs for typecheck/tests/build on Node 22 and 24, PostgreSQL/MySQL integration tests, and the strict documentation build. What remains to be configured by you: put the project on GitHub (or translate the workflow's plain `npm`/`pip`/`mkdocs` commands to your CI platform), let the first run pass, then add the badge `![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)`.

## More

[Configuration reference](docs/getting-started/configuration.md) - [Databases](docs/operations/databases.md) - [Backup and restore](docs/operations/backup-restore.md) - [Import/export and engine transfers](docs/operations/import-export.md) - [Architecture](docs/reference/architecture.md) - [Repository structure](docs/reference/repository-structure.md) - [Verification report](docs/project/verification.md)
