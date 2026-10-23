# Quick start

The shortest path from a fresh checkout to a running, verified OpsDesk. Each step names its working directory; **all commands run in the repository root** (the folder with `package.json`) unless stated otherwise. The same steps with more detail: [Local development](../guides/local-development.md), [Production](../guides/production.md), [Docker Compose](../guides/docker.md).

## 1. Create and edit the configuration

This is always the first step. See [Configuration reference](configuration.md) for every value.

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

The templates already describe a working SQLite setup; edit them only if you want a different port or data directory.

## 2. Verify prerequisites

```bash
node -v    # v22.13.0 or higher
npm -v     # 10 or higher
```

## 3. Install dependencies

```bash
npm ci
```

`npm ci` installs exactly what `package-lock.json` pins.

## 4. Validate configuration and prepare the database

```bash
npm run config:check    # prints effective, non-secret settings
npm run db:migrate      # creates the data directory and applies migrations
```

Migrations also run **automatically** at every start-up; `db:migrate` just lets you do it (and see errors) separately. The data directory is created automatically as well.

## 5. Build and start

```bash
npm run build
npm start
```

## 6. Open and verify

- Application: <http://127.0.0.1:4310>
- Health: `curl http://127.0.0.1:4310/api/health` (PowerShell: `Invoke-RestMethod http://127.0.0.1:4310/api/health`) - expect `"status": "green"`.
- The release version is shown at the bottom of the sidebar and in **Settings > About**; it equals `version` in `/api/health`.

On first launch choose **sample data** or an **empty dashboard**.

## 7. Optional: the documentation at `/docs/`

```bash
npm run docs:setup     # once: creates .venv-docs and installs the pinned MkDocs packages (needs Python 3.10+)
npm run docs:build     # strict build into dist/docs
```

Reload <http://127.0.0.1:4310/docs/> (the running server picks the build up without a restart). If you ran `npm run build` afterwards, run `npm run docs:build` again only when the documentation sources changed - `npm run build` does not delete `dist/docs`.

## 8. Stop and restart

Stop with `Ctrl+C`, start again with `npm start`. Your data is unchanged.
