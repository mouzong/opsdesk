# Production build and startup

A production run needs no Docker, no administrator rights and no internet access after installation. One process serves the API, the compiled frontend and (if built) this documentation from one address.

All commands run in the **repository root**.

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

Choose the port and data directory, and for PostgreSQL/MySQL the engine and `OPSDESK_DATABASE_URL` ([Databases](../operations/databases.md)). Keep the database URL in `.env` only.

## 2. Verify prerequisites

```bash
node -v    # >= v22.13.0
npm -v     # >= 10
python3 --version   # only for step 6 (documentation): >= 3.10   (PowerShell: py --version)
```

## 3. Install dependencies

```bash
npm ci
```

The build needs the development dependencies (TypeScript, Vite), so use plain `npm ci`.

## 4. Prepare the database

Migrations run **automatically at start-up**. To validate the configuration and apply them beforehand:

```bash
npm run config:check
npm run db:migrate
```

SQLite: the data directory and file are created for you. PostgreSQL/MySQL: create the empty database and account first ([Databases](../operations/databases.md#server-setup)).

## 5. Build the application

```bash
npm run build
```

Creates `dist/server`, `dist/web` and `dist/build-info.json` (version, real build time, commit id when available).

## 6. Build the documentation

```bash
npm run docs:setup     # once per machine/checkout: .venv-docs + pinned requirements
npm run docs:build     # strict build -> dist/docs
```

Shortcut for steps 5 and 6 once the toolchain exists: `npm run build:all`.

## 7. Start

```bash
npm start
```

| What | URL |
| --- | --- |
| Application | <http://127.0.0.1:4310/> (or your configured port) |
| Documentation | <http://127.0.0.1:4310/docs/> |
| Health | <http://127.0.0.1:4310/api/health> |

## 8. Verify health

```bash
curl http://127.0.0.1:4310/api/health
```

Expect HTTP 200 and `"status": "green"`; the `version` equals the one shown in the sidebar and **Settings > About**. Details: [Health endpoint](../operations/health.md).

## 9. Verify persistence

Create a bookmark, stop with `Ctrl+C`, run `npm start` again: the bookmark and its order are still there. With SQLite the data is in `<data dir>/opsdesk.sqlite`; Settings shows the location.

## Updating after a version change

After `git pull` or replacing the sources: `npm ci`, `npm run build:all`, restart. The version shown in the UI comes from `package.json` when the server starts, so a **restart is required**; see [Troubleshooting](../operations/troubleshooting.md#application-version-does-not-change-after-a-build). Back up before updating ([Backup and restore](../operations/backup-restore.md)).

## Running at login (optional)

- Windows: a shortcut to `cmd.exe /c "cd /d C:\path\to\opsdesk && npm start"` in `shell:startup` (use `npm.cmd` if needed).
- macOS/Linux: a `launchd` user agent or `systemd --user` unit running `npm start` in the repository folder.

Only one instance should use a database at a time.
