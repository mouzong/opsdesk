# Configuration reference

OpsDesk reads two optional local files and the process environment. **Create them first**: everything else in the setup guides assumes they exist.

| File | Purpose | Tracked in git? |
| --- | --- | --- |
| `.env` | Environment variables: ports, paths, **database credentials** | No - ignored (`.gitignore`, `.dockerignore`) |
| `opsdesk.config.json` | Non-secret application settings | No - ignored |
| `.env.example` | Safe template for `.env` | **Yes** |
| `opsdesk.config.example.json` | Safe template for `opsdesk.config.json` | **Yes** |

Both active files live in the **repository root** (the folder containing `package.json`).

## 1. Create the files

=== "macOS / Linux"

    ```bash
    # working directory: repository root
    cp .env.example .env
    cp opsdesk.config.example.json opsdesk.config.json
    ```

=== "Windows PowerShell"

    ```powershell
    # working directory: repository root
    Copy-Item .env.example .env
    Copy-Item opsdesk.config.example.json opsdesk.config.json
    ```

Then edit them with any editor. Validate them at any time (needs `npm ci` once):

```bash
npm run config:check
```

The command prints the effective, **non-secret** settings (listen address, data directory, engine) or a sanitized error and a non-zero exit code.

## 2. What is mandatory

**Nothing is mandatory for SQLite.** With no files at all OpsDesk listens on `127.0.0.1:4310` and keeps its data in a per-user folder. The copied templates are a working SQLite configuration:

```ini title=".env - minimum working SQLite configuration"
OPSDESK_PORT=4310
OPSDESK_DB_CLIENT=sqlite
```

```json title="opsdesk.config.json - minimum working configuration"
{
  "host": "127.0.0.1",
  "port": 4310
}
```

For **PostgreSQL or MySQL** two variables are mandatory: `OPSDESK_DB_CLIENT` and `OPSDESK_DATABASE_URL` (see [Databases](../operations/databases.md)).

## 3. Precedence and restarts

For every setting that exists in both places the order is:

1. **Process environment** (`OPSDESK_*` variables). Values from `.env` count as environment, but a variable that is *already set* in your shell is never overridden by `.env`.
2. **`opsdesk.config.json`**
3. **Built-in default**

Configuration is read **once at start-up**. **Restart OpsDesk after every change** to `.env` or `opsdesk.config.json`. (`npm run dev` restarts the API automatically when source files change, but not when `.env` changes - stop and start it.)

!!! warning "JSON does not support comments"
    `opsdesk.config.json` is strict JSON: no `//` comments, no trailing commas, and **unknown keys are rejected** with an error (so typos cannot silently do nothing). Use `.env.example` and these pages for explanations.

!!! info "Where `.env` is loaded"
    `npm start`, `npm run backup`, `npm run restore`, `npm run config:check` and `npm run db:migrate` pass `--env-file-if-exists=.env` to Node; `npm run dev` loads it itself. If you start `node dist/server/index.js` directly, load it yourself (`node --env-file=.env ...`) or export the variables. Docker Compose reads `.env` only to substitute variables in the compose files; the container image never contains it.

## 4. Where each setting belongs

Secrets (the database URL/password) belong **only** in the environment (`.env`, your shell, or `OPSDESK_DATABASE_URL_FILE`). `opsdesk.config.json` rejects a `url` key by design.

### Network and data

| Setting | `.env` variable | `opsdesk.config.json` key | Default | Notes |
| --- | --- | --- | --- | --- |
| Bind address | `OPSDESK_HOST` | `host` | `127.0.0.1` | Non-loopback values are refused unless `allowNetwork` is set. |
| Port | `OPSDESK_PORT` | `port` | `4310` | 1-65535. |
| Data directory | `OPSDESK_DATA_DIR` | `dataDir` | per-user folder (below) | Must be writable. Created automatically. Relative paths resolve from the working directory. |
| Allow non-loopback bind | `OPSDESK_ALLOW_NETWORK=1` | `allowNetwork` | `false` | Used by Docker. OpsDesk has no authentication; see [Security model](../operations/security.md). |
| Extra accepted host names | `OPSDESK_ALLOWED_HOSTS` (comma list) | `allowedHosts` | `[]` | Besides `localhost`, `127.0.0.1`, `[::1]`. |
| Automatic backups kept | - | `autoBackupKeep` | `20` | SQLite only. |
| Config file path | `OPSDESK_CONFIG` | - | `./opsdesk.config.json` | If set, the file **must** exist. |
| Serve the compiled frontend | `OPSDESK_SERVE_WEB=0` disables | - | on | Set by the dev launcher; the Vite dev server serves the UI instead. |

Default data directory: Windows `%LOCALAPPDATA%\OpsDesk`, macOS `~/Library/Application Support/OpsDesk`, Linux `$XDG_DATA_HOME/opsdesk` or `~/.local/share/opsdesk`.

### Database

| Setting | `.env` variable | `opsdesk.config.json` key (`database.`) | Default |
| --- | --- | --- | --- |
| Engine | `OPSDESK_DB_CLIENT` | `client` | `sqlite` (`sqlite`, `postgres`, `mysql`) |
| SQLite file | `OPSDESK_SQLITE_PATH` | `sqlitePath` | `<data dir>/opsdesk.sqlite` |
| Connection URL (**secret**) | `OPSDESK_DATABASE_URL` or `OPSDESK_DATABASE_URL_FILE` | *not allowed* | - |
| TLS mode | `OPSDESK_DB_SSL` (`auto`/`on`/`off`) | `ssl` | `auto` |
| Private CA bundle | `OPSDESK_DB_SSL_CA_FILE` | - | - |
| Skip certificate verification | `OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY=1` | - | off (prints a warning) |
| Pool size | `OPSDESK_DB_POOL_MAX` | `poolMax` | `5` |
| Connect timeout (ms) | `OPSDESK_DB_CONNECT_TIMEOUT_MS` | `connectTimeoutMs` | `10000` |
| Query timeout (ms) | `OPSDESK_DB_QUERY_TIMEOUT_MS` | `queryTimeoutMs` | `15000` |

Details and examples: [Databases](../operations/databases.md).

### HTTP API access

| Setting | `.env` variable | `opsdesk.config.json` key | Default | Notes |
| --- | --- | --- | --- | --- |
| API token (**secret**) | `OPSDESK_API_TOKEN` or `OPSDESK_API_TOKEN_FILE` | *not allowed* | unset = token access disabled | 24-256 characters of `A-Z a-z 0-9 . _ ~ + / = -`. Generate with `npm run token:generate`. See [Authentication](../api/authentication.md). |
| Browser origins allowed to call the API | `OPSDESK_CORS_ORIGINS` (comma list) | `corsOrigins` | `[]` | **Exact** origins only (`http://127.0.0.1:8000`); no wildcard, path or non-http(s) scheme. They still need the token. |
| Trust a reverse proxy's `X-Forwarded-Proto` | `OPSDESK_TRUST_PROXY=1` | `trustProxy` | `false` | Needed so tokens are accepted over HTTPS for non-local host names behind a TLS proxy. |

### Health, build and tooling variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPSDESK_HEALTH_TIMEOUT_MS` | `3000` | Time bound for each [health](../operations/health.md) check. |
| `OPSDESK_HEALTH_CACHE_SECONDS` | `5` | Health result cache (`0` disables). |
| `OPSDESK_DEBUG=1` | off | Prints full error objects for unexpected server errors (may include details - do not use with sensitive data in logs). |
| `OPSDESK_DEV_BACKEND_PORT` | `4311` | API port used by `npm run dev` (the Vite UI uses 5173). |
| `OPSDESK_COMMIT` | - | Commit id recorded in `dist/build-info.json` when the build runs outside a git checkout (for example in Docker). |
| `PW_CHANNEL` | `chrome` | Browser channel for `npm run test:e2e` (`msedge`, or empty for Playwright's Chromium). |
| `TEST_POSTGRES_URL`, `TEST_MYSQL_URL` | - | Enable the PostgreSQL/MySQL integration tests (disposable databases only). |

!!! note "Development mode overrides"
    `npm run dev` always runs the API on `OPSDESK_DEV_BACKEND_PORT` (4311), ignoring `OPSDESK_PORT` and the `port` key, and uses `.dev-data/` as data directory unless `OPSDESK_DATA_DIR` is set in the environment or `.env` (the `dataDir` key of the JSON file is not applied in dev). Database settings from `.env` apply normally.

## Errors you may see

Invalid configuration stops the start-up with a one-line message and exit code 1. Messages never contain the database URL or password.

| Message (shortened) | Cause |
| --- | --- |
| `Configuration file ... is not valid JSON` | Comment, trailing comma or other syntax error in `opsdesk.config.json`. |
| `Configuration file ... is invalid: <key>: ...` | Unknown key or wrong type (for example `"port": "4310"` as a string). |
| `Configuration file ... (OPSDESK_CONFIG) does not exist` | `OPSDESK_CONFIG` points to a missing file. |
| `Invalid port` | Port outside 1-65535. |
| `Refusing to bind to "<host>"` | Non-loopback host without `allowNetwork`. |
| `Unsupported database client "..."` | `OPSDESK_DB_CLIENT` is not `sqlite`, `postgres` or `mysql`. |
| `... requires OPSDESK_DATABASE_URL` | PostgreSQL/MySQL selected without a URL. |
| `OPSDESK_DATABASE_URL is set but OPSDESK_DB_CLIENT is "sqlite"` | A URL together with SQLite is refused instead of guessed. |
