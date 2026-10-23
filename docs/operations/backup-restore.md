# Backup and restore

OpsDesk stores everything in **one** database chosen at start-up. Backup and restore differ by engine - **never apply the SQLite file-copy procedures to PostgreSQL or MySQL.**

`<data>` means the data directory ([defaults](../getting-started/configuration.md#4-where-each-setting-belongs)). With SQLite it holds `opsdesk.sqlite` and `backups/`. With PostgreSQL/MySQL the data lives in the server; `<data>/backups/` only receives `pre-import-*.json` safety exports.

| Engine | Authoritative data | Back up with |
| --- | --- | --- |
| SQLite | `<data>/opsdesk.sqlite` (or `OPSDESK_SQLITE_PATH`) | OpsDesk: `npm run backup`, Settings |
| PostgreSQL | the `opsdesk` database | `pg_dump` |
| MySQL | the `opsdesk` database | `mysqldump` |
| any | - | [JSON export](import-export.md) (portable) |

## SQLite

`VACUUM INTO` produces a transactionally consistent copy **while the application runs**. Do not copy `opsdesk.sqlite` by hand while the app is running.

=== "UI"

    Settings > *Export and backups* > *Create backup now* (stored in `<data>/backups`, downloadable from the list).

=== "macOS / Linux"

    ```bash
    npm run backup
    npm run backup -- /path/to/opsdesk-before-change.sqlite
    ```

=== "Windows PowerShell"

    ```powershell
    npm run backup
    npm run backup -- C:\Backups\opsdesk-before-change.sqlite
    ```

**Automatic backups:** at every start-up, if there is data and the newest backup is older than 24 hours, an `auto-*` backup is made (the newest `autoBackupKeep`, default 20, are kept). `pre-import-*` and `pre-restore-*` backups are made before imports and restores and are never auto-deleted.

### Restore (SQLite)

**UI:** Settings > Backups > *Restore* > confirm. OpsDesk validates the file (integrity check, schema version, expected tables), saves the current data as `pre-restore-*.sqlite`, swaps the database atomically and reloads; a failed restore puts the previous data back.

**CLI (stop OpsDesk first):**

=== "macOS / Linux"

    ```bash
    npm run restore -- /path/to/backup.sqlite
    ```

=== "Windows PowerShell"

    ```powershell
    npm run restore -- C:\Backups\backup.sqlite
    ```

The command refuses to run while something listens on the configured port, validates the file, saves the current database as `pre-restore-*`, and replaces the database file. Backups from OpsDesk 1.0.0 restore fine (the version history is adopted).

## PostgreSQL

OpsDesk does **not** back up PostgreSQL (`npm run backup`/`restore` refuse to run; Settings says so). Use PostgreSQL's tools or your platform's backup service.

```bash title="Backup (consistent while OpsDesk runs; password via PGPASSWORD or ~/.pgpass)"
pg_dump --format=custom --file=opsdesk-$(date +%Y%m%d).dump "postgres://opsdesk@db.example.internal:5432/opsdesk"
```

```bash title="Restore (stop OpsDesk first)"
pg_restore --clean --if-exists --single-transaction --dbname="postgres://opsdesk@db.example.internal:5432/opsdesk" opsdesk-20261022.dump
```

PowerShell backup: `pg_dump --format=custom --file="opsdesk-$(Get-Date -Format yyyyMMdd).dump" "postgres://opsdesk@db.example.internal:5432/opsdesk"`. In Docker Compose: `docker compose exec postgres pg_dump -U opsdesk -Fc opsdesk > opsdesk.dump`.

If the dump is older than the application, pending migrations run at the next start. A dump from a *newer* OpsDesk makes [health](health.md) red (`schema_newer_than_application`) and the app refuses to start.

## MySQL

```bash title="Backup (consistent for InnoDB while OpsDesk runs)"
mysqldump --single-transaction --no-tablespaces -h db.example.internal -u opsdesk -p opsdesk > opsdesk-$(date +%Y%m%d).sql
```

```bash title="Restore (stop OpsDesk first; the dump drops and recreates the tables)"
mysql -h db.example.internal -u opsdesk -p opsdesk < opsdesk-20261022.sql
```

PowerShell has no `<` redirection: `cmd /c "mysql -h db.example.internal -u opsdesk -p opsdesk < opsdesk.sql"`. In Docker Compose: `docker compose exec mysql sh -c 'mysqldump -uopsdesk -p"$MYSQL_PASSWORD" --single-transaction --no-tablespaces opsdesk' > opsdesk.sql`.

Both procedures were verified against PostgreSQL 17.11 and MySQL 8.4.13: dump, delete data, restore, row counts back to the original.

## Before risky operations

Export JSON (works on every engine) and take the native backup. Imports additionally create a safety copy automatically: a `pre-import-*.sqlite` snapshot (SQLite) or a `pre-import-*.json` export in `<data>/backups/` (PostgreSQL/MySQL; restore it with Import > Replace).

## Docker

Default (SQLite): named volume `opsdesk-data` at `/data`:

```bash
docker compose exec opsdesk node --disable-warning=ExperimentalWarning scripts/backup.mjs /data/backups/manual-cli.sqlite
docker cp opsdesk:/data/backups/manual-cli.sqlite ./
```

With the PostgreSQL/MySQL overrides the data is in the `opsdesk-postgres` / `opsdesk-mysql` volume; use the `pg_dump`/`mysqldump` commands above through `docker compose exec`.
