# Migrations

## Are migrations automatic or manual?

**Automatic.** Every time the server starts, OpsDesk connects to the configured database and applies all pending migrations before it begins listening. If a migration fails, start-up stops with a sanitized error and the database is left unchanged (SQLite and PostgreSQL apply them in a transaction; MySQL cannot roll back DDL, so its statements are idempotent and guarded by a named lock).

You can also run them **manually**, separately from starting the server:

```bash
npm run db:migrate
```

(working directory: repository root; needs `npm ci`). The command creates the data directory if needed, connects to the engine from your configuration, applies pending migrations and prints the resulting schema version.

## How versions are tracked

All engines use the same table:

```
schema_migrations(version INTEGER PRIMARY KEY, name, applied_at)
```

`/api/health` reports `current_version` and `latest_version` as **strings** on every engine, plus the number of `pending` migrations. Pending migrations (or a database newer than the application) make the status **red**.

| Version | Name | Contents |
| --- | --- | --- |
| 1 | initial schema | `meta`, `workspaces`, `bookmark_groups`, `bookmarks` with indexes, cascading foreign keys and the environment `CHECK` |
| 2 | health probe table | empty `health_probe` table used by the rolled-back write probe |

## Upgrading existing SQLite databases

Databases written by OpsDesk 1.0.0 recorded their version in `PRAGMA user_version` and had no `schema_migrations` table. On first start the old version is **adopted** (version 1 recorded), then pending migrations run. This was verified with a file written by the real 1.0.0 build.

## Adding a migration (developers)

Append an object to `MIGRATIONS` in `server/db/migrations.ts` with statements for **all three dialects** and a new version number. Never edit a released migration. Add or adjust tests: the engine suites run every migration on an empty database for SQLite, PostgreSQL and MySQL.

## Downgrades

Not supported. An older build refuses a database whose highest applied version is newer than it knows. Restore a backup taken before the upgrade instead ([Backup and restore](backup-restore.md)).
