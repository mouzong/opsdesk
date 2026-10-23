# Local development

Everything runs from the **repository root**. Configuration comes first.

## 1. Create and edit the configuration

=== "macOS / Linux"

    ```bash
    cp .env.example .env
    cp opsdesk.config.example.json opsdesk.config.json
    ```

=== "Windows PowerShell"

    ```powershell
    Copy-Item .env.example .env
    Copy-Item opsdesk.config.example.json opsdesk.config.json
    ```

Read [Configuration reference](../getting-started/configuration.md) first, in particular the [development-mode overrides](../getting-started/configuration.md#4-where-each-setting-belongs): `npm run dev` uses API port 4311 and `.dev-data/` regardless of `OPSDESK_PORT`/`dataDir`.

## 2. Verify prerequisites

```bash
node -v    # >= v22.13.0
npm -v     # >= 10
```

## 3. Install dependencies

```bash
npm ci
```

## 4. Data directory and migrations

Nothing to create: the data directory (`.dev-data/` unless you set `OPSDESK_DATA_DIR`) and the schema are created **automatically** when the server starts. To run them separately and see problems early:

```bash
npm run config:check
npm run db:migrate
```

!!! note
    `db:migrate` honours the same `.env`, so it targets the same database as the dev server only if `OPSDESK_DATA_DIR` is also set in `.env` (otherwise it uses the default per-user data directory). For a purely local check use `OPSDESK_DATA_DIR=.dev-data npm run db:migrate` (PowerShell: `$env:OPSDESK_DATA_DIR = ".dev-data"; npm run db:migrate`).

## 5. Start development mode

```bash
npm run dev
```

This starts the API (`tsx watch`, restarts on server changes) and the Vite dev server with hot reload.

## 6. Open the app

<http://localhost:5173> - the UI. It proxies `/api` and `/docs` to the API on `127.0.0.1:4311`.

## 7. Verify health

```bash
curl http://127.0.0.1:4311/api/health      # or http://localhost:5173/api/health through the proxy
```

PowerShell: `Invoke-RestMethod http://127.0.0.1:4311/api/health`.

## 8. Stop and restart

`Ctrl+C` stops both processes. Run `npm run dev` again; data in `.dev-data/` persists.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript for server and web. |
| `npm test` | Unit and HTTP API tests (SQLite; plus PostgreSQL/MySQL if `TEST_POSTGRES_URL` / `TEST_MYSQL_URL` are set). |
| `npm run build` | Production build of server and frontend, plus `dist/build-info.json`. |
| `npm run test:e2e` | Playwright browser tests against the production build (`npm run build` first; build the docs first too if you want the documentation checks to run). |
| `npm run docs:serve` | Live-reloading documentation preview on <http://127.0.0.1:8000>. |

### Integration tests against PostgreSQL and MySQL

Use disposable databases only; the tests drop OpsDesk's tables.

```bash
docker run -d --name od-pg -e POSTGRES_USER=opsdesk -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=opsdesk_test -p 127.0.0.1:55432:5432 postgres:17-alpine
docker run -d --name od-my -e MYSQL_ROOT_PASSWORD=rootpw -e MYSQL_USER=opsdesk -e MYSQL_PASSWORD=testpw -e MYSQL_DATABASE=opsdesk_test -p 127.0.0.1:53306:3306 mysql:8.4
TEST_POSTGRES_URL=postgres://opsdesk:testpw@127.0.0.1:55432/opsdesk_test \
TEST_MYSQL_URL=mysql://opsdesk:testpw@127.0.0.1:53306/opsdesk_test npm test
```

PowerShell: set `$env:TEST_POSTGRES_URL = "..."` and `$env:TEST_MYSQL_URL = "..."`, then `npm test`.

The browser test can run against an engine too: `OPSDESK_DB_CLIENT=postgres OPSDESK_DB_SSL=off OPSDESK_DATABASE_URL=... npm run test:e2e`.
