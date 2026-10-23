# Databases

SQLite is the default and needs nothing else. **PostgreSQL** and **MySQL** are fully supported and chosen **at start-up** by configuration. There is no switch in the UI and OpsDesk never moves data between engines on its own: **Settings** and [`/api/health`](health.md) only *show* the active engine, read-only.

!!! warning "Changing the engine does not migrate data"
    A different engine starts with an empty database. Move content with the portable export/import: [Import, export and engine transfers](import-export.md).

## Configuration contract

| Variable | Default | Used by | Meaning |
| --- | --- | --- | --- |
| `OPSDESK_DB_CLIENT` | `sqlite` | all | `sqlite`, `postgres` or `mysql` (aliases `postgresql`, `pg`, `mariadb`). Anything else stops start-up. |
| `OPSDESK_SQLITE_PATH` | `<data dir>/opsdesk.sqlite` | SQLite | Database file. |
| `OPSDESK_DATABASE_URL` | - | PostgreSQL, MySQL | `postgres://user:password@host:5432/database` or `mysql://user:password@host:3306/database`. **Required** for those engines; **refused** together with `sqlite`. Percent-encode special characters in the password (`@`→`%40`, `/`→`%2F`, `:`→`%3A`). Query parameters are rejected - use the variables below. |
| `OPSDESK_DATABASE_URL_FILE` | - | PostgreSQL, MySQL | File containing the URL (secrets mounts). Not combinable with `OPSDESK_DATABASE_URL`. |
| `OPSDESK_DB_SSL` | `auto` | PostgreSQL, MySQL | `auto` = TLS for every host except localhost, `on`, `off`. **Certificates are verified.** |
| `OPSDESK_DB_SSL_CA_FILE` | - | PostgreSQL, MySQL | PEM bundle with your private CA. |
| `OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY` | unset | PostgreSQL, MySQL | `1` disables certificate verification; last resort, prints a warning at every start. |
| `OPSDESK_DB_POOL_MAX` | `5` | PostgreSQL, MySQL | Pool size. |
| `OPSDESK_DB_CONNECT_TIMEOUT_MS` | `10000` | PostgreSQL, MySQL | Connect timeout. |
| `OPSDESK_DB_QUERY_TIMEOUT_MS` | `15000` | PostgreSQL, MySQL | Query timeout. |

The non-secret ones also exist as keys in the `database` object of `opsdesk.config.json` (`client`, `sqlitePath`, `ssl`, `poolMax`, `connectTimeoutMs`, `queryTimeoutMs`); the **URL is environment-only**. Precedence and restarts: [Configuration reference](../getting-started/configuration.md#3-precedence-and-restarts).

## SQLite (default)

```ini title=".env"
OPSDESK_DB_CLIENT=sqlite
# OPSDESK_SQLITE_PATH=./data/opsdesk.sqlite
```

- Uses Node's built-in `node:sqlite` (no native module). Pragmas: `foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=DELETE`, `synchronous=FULL` - a **single plain file** with no `-wal`/`-shm` companions, so backup and moves are simple.
- Requires **Node.js 22.13+**. Node prints an "ExperimentalWarning: SQLite" message; `npm start` hides it.

## PostgreSQL

```ini title=".env"
OPSDESK_DB_CLIENT=postgres
OPSDESK_DATABASE_URL=postgres://opsdesk:CHANGE_ME@db.example.internal:5432/opsdesk
```

PostgreSQL 13 or newer (tested with 17.11).

## MySQL

```ini title=".env"
OPSDESK_DB_CLIENT=mysql
OPSDESK_DATABASE_URL=mysql://opsdesk:CHANGE_ME@db.example.internal:3306/opsdesk
```

MySQL 8.0.16 or newer, because `CHECK` constraints must be enforced (tested with 8.4.13). MariaDB is accepted as a client alias but **not tested**.

## Server setup

Create an empty database and a dedicated account that may create tables in it; OpsDesk applies its own [migrations](migrations.md) at start-up.

```sql title="PostgreSQL"
CREATE ROLE opsdesk LOGIN PASSWORD 'CHANGE_ME';
CREATE DATABASE opsdesk OWNER opsdesk;
```

```sql title="MySQL"
CREATE DATABASE opsdesk CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'opsdesk'@'%' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON opsdesk.* TO 'opsdesk'@'%';
```

## TLS

For a remote server keep `OPSDESK_DB_SSL=auto` (or `on`). If the server uses a private CA, provide it:

```ini
OPSDESK_DB_SSL=on
OPSDESK_DB_SSL_CA_FILE=/etc/ssl/internal-ca.pem
```

Verified behaviour (PostgreSQL, self-signed certificate): refused by default (`DEPTH_ZERO_SELF_SIGNED_CERT`), connects with the CA file, connects unverified only with `OPSDESK_DB_SSL_INSECURE_SKIP_VERIFY=1`. In the Compose files TLS is off between the two containers on their private network; use TLS for any remote database.

## Rules that apply to every engine

- **No silent fallback.** A failed connection stops start-up with a sanitized message (only an error code such as `ECONNREFUSED` or `28P01`); OpsDesk never switches to SQLite.
- **Credentials stay on the server.** They never appear in API responses, `/api/health`, logs, error messages or the frontend bundle (tests check this). Start-up prints only the engine name and whether TLS is on.
- **Identical schema and data semantics.** Foreign keys with cascade, a `CHECK` on the environment, the same indexes; booleans stored as `0/1`, timestamps as ISO-8601 text, tags as JSON text, ids as UUID text.
- **One OpsDesk instance per database.** Write transactions are serialised inside the process (SQLite: queue + `BEGIN IMMEDIATE`; PostgreSQL/MySQL: one write transaction at a time).

## Docker Compose

Compose files with optional database containers are described in [Docker Compose](../guides/docker.md).
