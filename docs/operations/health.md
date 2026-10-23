# Health endpoint

`GET /api/health` reports whether OpsDesk itself can do its job. It is used by the Docker `HEALTHCHECK` and is suitable for any monitor. **Bookmarked services are never probed**: a bookmark says nothing about the health of the service behind it.

```bash
curl -i http://127.0.0.1:4310/api/health
```

## Example

```json
{
  "application_name": "opsdesk",
  "status": "green",
  "timed_out": false,
  "version": "1.3.0",
  "timestamp": "2026-10-22T09:30:00Z",
  "uptime_in_seconds": 86400,
  "cached": false,
  "checks": {
    "database":   { "status": "green", "type": "sqlite", "readable": true, "writable": true, "response_time_ms": 2 },
    "storage":    { "status": "green", "data_directory_writable": true, "backup_directory_writable": true },
    "migrations": { "status": "green", "current_version": "2", "latest_version": "2", "pending": 0 }
  },
  "response_time_ms": 5
}
```

## Status meanings and HTTP codes

| Status | Meaning | HTTP |
| --- | --- | --- |
| `green` | All checks pass. | `200` |
| `yellow` | Core functionality works; an optional capability is degraded (the local backups / safety-export folder is not writable). | `200` |
| `red` | A critical dependency fails: database unreadable or unwritable or too slow, the SQLite directory not writable, migrations pending, or a database newer than this build. | `503` |

The overall status is the **worst** individual status.

## Fields

| Field | Meaning |
| --- | --- |
| `application_name` | Always `opsdesk`. |
| `status` | Overall status. |
| `timed_out` | `true` if any check exceeded its time bound. |
| `version` | Release version from `package.json` - the same value the UI shows in the sidebar and **Settings > About**. |
| `timestamp`, `uptime_in_seconds` | Response time and process uptime. |
| `cached` | `true` if this answer came from the short cache. |
| `response_time_ms` | Time to produce the report. |
| `checks.database.type` | Active engine: `sqlite`, `postgresql` or `mysql` (read-only information). |
| `checks.database.readable` / `writable` | Real read and write capability (see below). |
| `checks.storage.data_directory_writable` | SQLite: the database directory accepts new files. PostgreSQL/MySQL: `"not_applicable"`. |
| `checks.storage.backup_directory_writable` | The backups folder (SQLite backups, or `pre-import-*.json` safety exports) accepts files. |
| `checks.migrations.current_version` / `latest_version` / `pending` | Highest applied and highest known migration version (strings on every engine) and the number still pending. |
| `error` (inside a failing check) | A short code: `timeout`, `read_failed`, `write_failed`, `unavailable`, `not_writable`, `migrations_pending`, `schema_newer_than_application`. |

## How the checks work

- **Write probe:** inserts one row into the dedicated `health_probe` table inside a transaction that is **always rolled back**. No user table is touched and nothing is left behind; a read-only file or replica fails here.
- **Directory checks:** create and delete a uniquely named temporary file - existence alone does not prove writability.
- **Time bounds:** each check is limited by `OPSDESK_HEALTH_TIMEOUT_MS` (default 3000). A timed-out check is `red` with `"error": "timeout"` and the top-level `timed_out` is `true`.
- **Cache:** results are reused for `OPSDESK_HEALTH_CACHE_SECONDS` (default 5; a `red` result for at most 1 s so recovery shows quickly); concurrent requests share one computation.
- **Sanitized:** responses never contain filesystem paths, credentials, connection strings, host names, stack traces or raw database errors.

## Reading a red or yellow result

| Observation | Likely cause and action |
| --- | --- |
| `migrations_pending` | Restart OpsDesk (migrations run at start-up) or check the account's table-creation rights. |
| `schema_newer_than_application` | Database written by a newer OpsDesk; update the application or restore an older backup. |
| `read_failed` / `write_failed` | Database down, read-only replica/file, or permissions changed. |
| `timeout` | Database too slow; check load or raise `OPSDESK_HEALTH_TIMEOUT_MS`. |
| `yellow` with `backup_directory_writable: false` | The backups folder is not writable; fix permissions. The app keeps working. |

See also [Troubleshooting](troubleshooting.md).
