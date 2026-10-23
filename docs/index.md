# OpsDesk

OpsDesk is a **local, offline bookmarks dashboard** for infrastructure and operations work. It keeps the URLs you need during daily operations and incidents - Kibana, Grafana, GitLab, runbooks, ticket queues - organised in **workspaces** and **groups**, with fast search, a command palette and portable backups.

It runs on your own machine, bound to `127.0.0.1`, for a single user. There is no cloud service, no account, no telemetry, and it never contacts the services you bookmark.

<div class="grid cards" markdown>

- **[Quick start](getting-started/quick-start.md)** - configure, install, start, verify in a few minutes.
- **[Configuration reference](getting-started/configuration.md)** - every `.env` and `opsdesk.config.json` setting.
- **[Databases](operations/databases.md)** - SQLite (default), PostgreSQL or MySQL.
- **[Health endpoint](operations/health.md)** - `/api/health`, fields and status meanings.

</div>

## Features

- **Workspaces, groups and bookmark cards** with environments (production is unmistakable), tags, owners, notes, pinned favourites and recently opened links.
- **Search and filters** across title, description, URL, tags and owner; command palette on `Ctrl/Cmd+K`; keyboard navigation.
- **Drag and drop reordering**, with menu-based alternatives for every move.
- **Portable JSON export/import** with exact preview, merge or replace modes, and browser-bookmark (HTML) import.
- **Three database engines**: SQLite by default, PostgreSQL and MySQL by explicit configuration.
- **Backups**: consistent SQLite snapshots, automatic start-up backups, safety backups before imports and restores.
- **Health endpoint** with green/yellow/red status for monitors and Docker health checks.
- **Dark, light and system themes**, compact and comfortable layouts, accessible forms and focus handling.
- **This documentation** is built from the repository and served by the application itself at `/docs/`, with no external fonts, scripts or analytics.

## What it deliberately does not do

No authentication or multi-user support, no live service-health monitoring, no favicon fetching or link previews, no cloud sync, no AI features. Having a bookmark never implies that a service is healthy. See the [security model](operations/security.md).

## Where to go next

| I want to... | Read |
| --- | --- |
| Install and run it today | [Quick start](getting-started/quick-start.md) |
| Check versions and requirements | [Prerequisites](getting-started/prerequisites.md) |
| Develop or change OpsDesk | [Local development](guides/local-development.md) |
| Run it for real | [Production build and startup](guides/production.md) or [Docker Compose](guides/docker.md) |
| Switch to PostgreSQL or MySQL | [Databases](operations/databases.md), [Import, export and engine transfers](operations/import-export.md) |
| Back up and restore | [Backup and restore](operations/backup-restore.md) |
| Fix a problem | [Troubleshooting](operations/troubleshooting.md) |
| Cut a release | [Releases and versioning](project/releases.md) |
