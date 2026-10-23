# Troubleshooting

## Quick table

| Symptom | Cause and fix |
| --- | --- |
| `Configuration file ... is not valid JSON` / `... is invalid` | `opsdesk.config.json` contains a comment, a trailing comma, an unknown key or a wrong type. Compare with `opsdesk.config.example.json`; run `npm run config:check`. |
| Settings in `.env` / `opsdesk.config.json` have no effect | The server was not restarted, the file is not in the repository root, a variable already set in your shell takes precedence over `.env`, or an environment variable overrides the JSON key. See [precedence](../getting-started/configuration.md#3-precedence-and-restarts). `npm run config:check` shows the effective values. |
| `.env not found. Continuing without it.` | Harmless note from Node when no `.env` exists; defaults and `opsdesk.config.json` apply. |
| `No such built-in module: node:sqlite` / `engines` warning | Node.js is older than 22.13. Install 22 LTS or 24 LTS; `node -v` to check. |
| Documentation toolchain: `Python 3.10 or newer is required` / `No suitable Python found` | Install Python 3.10+ (only needed for the docs; `py --version` on Windows, `python3 --version` elsewhere) and run `npm run docs:setup` again. |
| `Port 4310 is already in use` | Set another port (`OPSDESK_PORT=4311`) or find the process: macOS/Linux `lsof -i :4310`; PowerShell `Get-NetTCPConnection -LocalPort 4310 \| Select OwningProcess`, then `Get-Process -Id <pid>`. |
| `Not allowed to listen on port` | Ports below 1024 need elevated rights; use 4310 or higher. |
| `EACCES`/`EPERM` on the data directory, `unable to open database file` | The data directory must be writable by your user. Set `OPSDESK_DATA_DIR` to a folder you own; avoid read-only or synced network folders. `/api/health` shows `data_directory_writable: false`. |
| `database is locked` | Another OpsDesk process uses the same SQLite file. Stop it. |
| `Could not connect to the PostgreSQL/MySQL database (CODE)` | The code is the only detail shown. `ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`: host, port, firewall. `28P01` / `ER_ACCESS_DENIED_ERROR`: user or password (percent-encode special characters). `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `HANDSHAKE_SSL_ERROR`: untrusted server certificate - provide `OPSDESK_DB_SSL_CA_FILE`. `The server does not support SSL`: use `OPSDESK_DB_SSL=off` only on a trusted private network. OpsDesk never falls back to SQLite. |
| `Database migration failed` | The account cannot create tables; grant the privileges in [Databases](databases.md#server-setup). `npm run db:migrate` reproduces the problem without starting the server. |
| "The database was created by a newer OpsDesk" | An older build started on newer data. Update OpsDesk or restore an older backup. |
| `/docs/` shows "The documentation has not been built" | Run `npm run docs:setup` once, then `npm run docs:build`, and reload (no restart needed). `npm run build` alone does not build the docs. |
| `npm run docs:build` fails in strict mode | Read the first `WARNING` line: it names the page and the broken link/anchor or configuration key. Fix and rebuild. |
| Application version does not change after a build | See [below](#application-version-does-not-change-after-a-build). |
| Browser shows "the frontend has not been built" | Run `npm run build`. |
| "Cross-origin requests are not allowed" / "This host name is not allowed" | You opened OpsDesk through another host name. Use `http://127.0.0.1:4310` or `http://localhost:4310`, or add the name to `allowedHosts`. |
| "Missing or invalid CSRF token" after a restart | Reload the page. |
| API: `401 authentication_required` / `api_auth_not_configured` on POST/PATCH/DELETE | Send `Authorization: Bearer <token>` and set `OPSDESK_API_TOKEN` on the server (then restart). See [Authentication](../api/authentication.md). |
| API: `401 invalid_token`, `429 too_many_requests` | Wrong token (after 20 failures the server throttles; wait for `Retry-After`). |
| API: `403 https_required` / `bad_origin` / `host_not_allowed` | Token sent over HTTP to a non-local host name; browser origin not in `OPSDESK_CORS_ORIGINS`; host name not in `allowedHosts`. |
| API: `412 precondition_failed` | The resource changed since you read it: fetch again and resend with the new ETag. |
| Swagger "Try it out" fails in a standalone docs preview | Start OpsDesk with `OPSDESK_CORS_ORIGINS=<preview origin>` and `OPSDESK_API_TOKEN`, enter the API server in the form above the reference, and press Authorize. |
| `npm ci` fails behind a proxy | Configure the proxy/registry. `npm ci` needs no compilers for this project. |
| PowerShell: "running scripts is disabled" | Use `npm.cmd ...` instead of `npm ...`. |
| `/api/health` returns 503 | Read the `checks` object; see [Health endpoint](health.md#reading-a-red-or-yellow-result). |

## Application version does not change after a build

The version comes from `package.json` and is **read when the server starts**; the UI gets it from `/api/session`, which is the same value as `/api/health`.

1. **Restart the server** after changing `package.json` (or after `npm version`).
2. Run `npm run build` so `dist/build-info.json` is regenerated. A build-info file from an older version is deliberately **ignored** (the build date and commit then disappear from Settings > About instead of showing stale data).
3. Hard-reload the browser tab.
4. Docker: `docker compose up -d --build` (the image bakes the version in).
5. Compare: `curl http://127.0.0.1:4310/api/health` (field `version`) and `grep '"version"' package.json`.

## Collecting information

`OPSDESK_DEBUG=1 npm start` prints full error objects for unexpected server errors (they may contain details; do not share them unreviewed). `npm run config:check` shows the effective, non-secret configuration.
