# API quick start

Everything the OpsDesk web UI can do is also available over HTTP, so you can script it with `curl`. The contract is described by an [OpenAPI 3.1 document](reference.md) generated from the server's own route definitions and validators, and the [coverage table](coverage.md) maps every UI operation to its endpoint.

| | |
| --- | --- |
| Base URL | `http://127.0.0.1:4310/api/v1` (replace the port with your `OPSDESK_PORT`) |
| Format | JSON (`application/json`), UTF-8; file uploads use `multipart/form-data`; exports and backups are downloads |
| Machine-readable contract | `GET /api/v1/openapi.json` (also shipped in this site as `api/openapi.json`) |
| Interactive reference | [Swagger UI](reference.md) |
| Authentication | `Authorization: Bearer <token>` for every change; see [Authentication](authentication.md) |

## 1. Enable token access (once)

The API token is a server-side secret. Generate one and put it in `.env` (never commit it), then **restart** OpsDesk:

=== "macOS / Linux"

    ```bash
    npm run token:generate                       # prints a random 48-character token
    echo 'OPSDESK_API_TOKEN=<paste the token>' >> .env
    npm start
    ```

=== "Windows PowerShell"

    ```powershell
    npm run token:generate                       # prints a random 48-character token
    Add-Content .env 'OPSDESK_API_TOKEN=<paste the token>'
    npm start
    ```

Without `OPSDESK_API_TOKEN` the API is read-only for command-line clients: every change is refused with `401`. (The web UI keeps working either way.)

## 2. Call it

=== "macOS / Linux"

    ```bash
    export BASE=http://127.0.0.1:4310/api/v1
    read -rs OPSDESK_API_TOKEN && export OPSDESK_API_TOKEN      # type or paste the token; it is not echoed

    curl -s "$BASE/health"                                       # no token needed
    curl -s "$BASE/workspaces" | jq                              # reads: no token needed on localhost
    printf 'Authorization: Bearer %s\n' "$OPSDESK_API_TOKEN" > /tmp/od-auth && chmod 600 /tmp/od-auth
    curl -s -X POST "$BASE/workspaces" -H @/tmp/od-auth -H 'Content-Type: application/json' -d '{"name":"Observability"}' | jq
    ```

=== "Windows PowerShell"

    ```powershell
    $env:BASE = 'http://127.0.0.1:4310/api/v1'
    $env:OPSDESK_API_TOKEN = Read-Host -MaskInput 'API token'     # PowerShell 7+; in 5.1: Read-Host 'API token'

    curl.exe -s "$env:BASE/health"
    curl.exe -s "$env:BASE/workspaces"
    $auth = New-TemporaryFile; [IO.File]::WriteAllText($auth.FullName, "Authorization: Bearer $env:OPSDESK_API_TOKEN`n")
    '{"name":"Observability"}' | Set-Content body.json
    curl.exe -s -X POST "$env:BASE/workspaces" -H "@$($auth.FullName)" -H 'Content-Type: application/json' --data-binary '@body.json'
    ```

Putting the header in a private file (`-H @file`) keeps the token out of the process list and shell history. The [cookbook](cookbook.md) uses this pattern for every example.

!!! warning "Never paste a real token into documentation, tickets or shell history"
    Do not use `set -x`/`bash -x` or PowerShell tracing while the token is in use, and never put it in a URL. The server never logs it and never returns it.

## 3. What you can do

| Area | Operations (see [coverage](coverage.md)) |
| --- | --- |
| Workspaces | list, read, create, rename/icon, reorder, delete (move or delete contents) |
| Groups | list, read, create, rename/collapse, reorder, move between workspaces, delete (move or delete contents) |
| Bookmarks | list/search, read, create, edit, pin/unpin, duplicate, move, reorder, delete |
| Search and metadata | filters, sorting, pagination; tags; environment values |
| Recent | list, record an opening, clear |
| Settings | dashboard title; first-run setup; remove sample data |
| Import and export | JSON export; JSON/HTML import with preview, merge and protected replace; multipart upload |
| Backups | list, metadata, create, download, restore, delete (SQLite) |
| System | health, version, capabilities (engine, limits), OpenAPI document |

## Conventions

- **Identifiers** are opaque UUID strings, stable for the lifetime of the resource.
- **Timestamps** are ISO 8601 UTC.
- **Creating** returns `201 Created` with the new resource and a `Location` header. Changing and moving return the resource or `{"ok": true}`; deleting returns `{"ok": true}`.
- **Unknown JSON fields** in request bodies are ignored; invalid or out-of-range values are rejected with `400` and field details.
- **Request ids**: every response has `X-Request-Id` (you may send your own, 8-64 characters); errors repeat it in the body.
- **Request limits**: JSON bodies 256 KB (imports 7 MB), uploaded files 5 MB, page size at most 200, field lengths as in the UI (e.g. title 120, note 4000 characters).

## Versioning policy

The stable contract is **`/api/v1`**. The unversioned `/api` prefix is an alias of the current version, kept because the bundled UI uses it. Inside `v1` changes are backwards compatible: new endpoints, new optional request fields, new response fields. A breaking change would be published as `/api/v2` alongside `v1`. The OpenAPI document's `info.version` is the application release (`GET /version`), and `GET /capabilities` returns `apiVersion`.

## Concurrency, retries and idempotency

| Class | Operations | Retrying |
| --- | --- | --- |
| **Safe** (never change data) | every `GET`, import preview | always safe; `GET /health` runs its write probe in a rolled-back transaction |
| **Idempotent** | `PATCH`, `DELETE` (a repeated delete returns `404`), moves, `PATCH /settings`, clear recent, remove sample data | repeating has the same effect as once |
| **Not idempotent** | creating (`POST` workspace/group/bookmark/backup), duplicate, record opening, apply import, setup | send an `Idempotency-Key` header: a retry with the same key and body replays the first response (`Idempotent-Replayed: true`); the same key with a different body is `422` |

**Lost updates:** `GET` of a workspace, group or bookmark returns an `ETag`. Send it back as `If-Match` on `PATCH`, `DELETE` or `move`; if the resource changed meanwhile you get `412 precondition_failed` and **nothing is modified**. The check and the change run in one transaction. `If-Match` is optional but recommended for scripts.

Idempotency keys are kept for 24 hours in the server's memory (they do not survive a restart).

## Next steps

[Authentication](authentication.md) - [curl cookbook](cookbook.md) - [Pagination and filtering](pagination-filtering.md) - [Import and export](import-export.md) - [Errors and status codes](errors.md) - [Interactive reference](reference.md)
