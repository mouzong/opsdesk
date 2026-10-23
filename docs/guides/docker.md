# Docker Compose deployment

Optional: OpsDesk works without Docker. The image is built from the repository's `Dockerfile` and **includes this documentation** (built in a Python stage, served at `/docs/`).

Everything runs from the **repository root**.

## 1. Create and edit the configuration

=== "macOS / Linux"

    ```bash
    cp .env.example .env
    ```

=== "Windows PowerShell"

    ```powershell
    Copy-Item .env.example .env
    ```

In Docker, `.env` is used by Compose to **substitute variables in the compose files** (the container image never contains it). For the default SQLite setup the only relevant value is `OPSDESK_PORT` (the **host** port; the container always listens on 4310). `opsdesk.config.json` is not copied into the image; the image sets its own `OPSDESK_*` environment (`OPSDESK_HOST=0.0.0.0`, `OPSDESK_ALLOW_NETWORK=1`, `OPSDESK_DATA_DIR=/data`), which takes precedence anyway.

For PostgreSQL or MySQL also set the passwords (`openssl rand -hex 24` generates a URL-safe one):

```ini
POSTGRES_PASSWORD=...          # docker-compose.postgres.yml
MYSQL_PASSWORD=...             # docker-compose.mysql.yml
MYSQL_ROOT_PASSWORD=...
```

## 2. Verify prerequisites

```bash
docker --version
docker compose version
```

## 3-4. Data directory and migrations

Nothing to create: the container's `/data` is a named volume, and migrations run automatically when the container starts.

## 5. Build and start

=== "SQLite (default)"

    ```bash
    docker compose up -d --build
    ```

=== "PostgreSQL"

    ```bash
    docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d --build
    ```

=== "MySQL"

    ```bash
    docker compose -f docker-compose.yml -f docker-compose.mysql.yml up -d --build
    ```

Only the services you ask for start: the default file defines just `opsdesk`; the override files add one database container each. The database containers publish **no ports**.

## 6. Open the app and the docs

- Application: <http://127.0.0.1:4310/> (the host port is `OPSDESK_PORT`, default 4310, published on the loopback interface only)
- Documentation: <http://127.0.0.1:4310/docs/>

## 7. Verify health

```bash
docker compose ps                                  # opsdesk should be "healthy"
curl http://127.0.0.1:4310/api/health
```

The container's `HEALTHCHECK` calls `/api/health` (HTTP 200 for green and yellow, 503 for red).

## 8. Persistence and restart

```bash
docker compose restart opsdesk      # data stays
docker compose down                 # stops, keeps volumes
docker compose down -v              # DELETES the volumes (add the same -f files you used to start)
```

## Build arguments

| Argument | Meaning |
| --- | --- |
| `OPSDESK_COMMIT` | Commit id to record in the build info shown in **Settings > About** (the image has no `.git`). Example: `docker compose build --build-arg OPSDESK_COMMIT=$(git rev-parse --short=12 HEAD)`. If omitted, no commit is shown. |

The image is tagged `opsdesk:local`; the release version comes from `package.json` inside the image, so there is no second version string to maintain.

## Security notes

The container runs as a non-root user with a read-only root filesystem, `no-new-privileges` and all capabilities dropped. The port is published on `127.0.0.1` only; do not change that without adding authentication and TLS in front. See [Security model](../operations/security.md).
