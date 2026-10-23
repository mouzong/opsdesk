# curl cookbook

Working examples for **every** supported operation, in POSIX shell (bash/zsh with `curl` and `jq`) and Windows PowerShell (`curl.exe`). They are extracted from the scripts `docs/api/examples/cookbook.sh` and `cookbook.ps1`, which walk through the whole API in order.

!!! success "Tested"
    `cookbook.sh` is executed against a running OpsDesk server by the project's test suite (`server/tests/cookbook.test.ts`), so the shell examples on this page are known to work. `cookbook.ps1` mirrors it but **has not been executed** in the project's test environment (no PowerShell available there): treat it as untested and report problems.

## Prerequisites and conventions

- A running OpsDesk with `OPSDESK_API_TOKEN` set ([Authentication](authentication.md)). **Use a scratch server or a scratch workspace:** the cookbook creates and deletes demo data (it never touches other data, except the optional replace-import demo, which only runs when `COOKBOOK_ALLOW_REPLACE=1`).
- `jq` extracts IDs from JSON in the shell version ([jqlang.org](https://jqlang.org/); `brew install jq`, `apt install jq`, `winget install jqlang.jq`). The PowerShell version uses the built-in `ConvertFrom-Json`.
- **IDs are captured from the responses** (`WS=$(... | jq -r .id)`); nothing assumes fixed values. Domains are reserved examples (`example.org`).
- **Token handling:** the token comes from the environment and is written to a private temporary file that `curl -H @file` reads, so it never appears in the process list or in your shell history. Do not enable `set -x` / `bash -x`.
- `--fail-with-body` (curl 7.76+) makes curl exit non-zero on HTTP errors **and still print the JSON error body**.
- PowerShell: always call `curl.exe` (plain `curl` is an alias of `Invoke-WebRequest`), and send JSON from a **file** (`--data-binary "@body.json"`): it avoids the quote-stripping that PowerShell applies to native command arguments.

## Run the whole thing

=== "macOS / Linux"

    ```bash
    export BASE=http://127.0.0.1:4310/api/v1
    read -rs OPSDESK_API_TOKEN && export OPSDESK_API_TOKEN
    bash docs/api/examples/cookbook.sh          # prints "COOKBOOK OK" at the end
    ```

=== "Windows PowerShell"

    ```powershell
    $env:BASE = 'http://127.0.0.1:4310/api/v1'
    $env:OPSDESK_API_TOKEN = Read-Host -MaskInput 'API token'
    .\docs\api\examples\cookbook.ps1
    ```

Download: [cookbook.sh](examples/cookbook.sh) - [cookbook.ps1](examples/cookbook.ps1)

## Setup

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:setup"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:setup"
    ```

## 1. Health, version and capabilities

No token needed. `/health` answers `200` for green/yellow and `503` for red.

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:health"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:health"
    ```

## 2. Create and read workspaces

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:create-workspace"
    --8<-- "docs/api/examples/cookbook.sh:read-workspaces"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:create-workspace"
    --8<-- "docs/api/examples/cookbook.ps1:read-workspaces"
    ```

## 3. Create groups

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:create-group"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:create-group"
    ```

## 4. Create bookmarks

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:create-bookmark"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:create-bookmark"
    ```

## 5. Retrieve and search

Searching works like the UI search: terms are ANDed, case-insensitive, over title, description, URL, tags and owner. Omit `workspaceId` to search **all workspaces**. See [Pagination and filtering](pagination-filtering.md).

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:search"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:search"
    ```

## 6. Edit, favorite, duplicate, move, reorder

**Pin and favorite are the same field** (`favorite`). Moves and reorders use the zero-based `index` within the target list and run in one transaction.

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:edit"
    --8<-- "docs/api/examples/cookbook.sh:favorite"
    --8<-- "docs/api/examples/cookbook.sh:duplicate"
    --8<-- "docs/api/examples/cookbook.sh:move"
    --8<-- "docs/api/examples/cookbook.sh:group-workspace-ops"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:edit"
    --8<-- "docs/api/examples/cookbook.ps1:favorite"
    --8<-- "docs/api/examples/cookbook.ps1:duplicate"
    --8<-- "docs/api/examples/cookbook.ps1:move"
    --8<-- "docs/api/examples/cookbook.ps1:group-workspace-ops"
    ```

## 7. Lost-update protection and safe retries

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:conditional"
    --8<-- "docs/api/examples/cookbook.sh:idempotency"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:conditional"
    --8<-- "docs/api/examples/cookbook.ps1:idempotency"
    ```

## 8. Recently opened

Recording is an explicit `POST`; reading the list or a bookmark never records anything, and the server never opens URLs.

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:recent"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:recent"
    ```

## 9. Settings

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:settings"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:settings"
    ```

## 10. Export (download)

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:export"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:export"
    ```

## 11. Import: preview, then merge (JSON and upload)

The preview runs the real import in a transaction that is rolled back: **it never changes data**. More: [Import and export](import-export.md).

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:import-merge"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:import-merge"
    ```

## 12. Browser bookmarks (HTML)

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:import-html"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:import-html"
    ```

## 13. Protected replace import

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:import-replace"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:import-replace"
    ```

## 14. Backups (SQLite)

On PostgreSQL/MySQL these endpoints return `409 not_supported`; use `pg_dump` / `mysqldump` ([Backup and restore](../operations/backup-restore.md)).

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:backups"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:backups"
    ```

## 15. Inspect HTTP failures

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:errors"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:errors"
    ```

## 16. Delete the example resources safely

Deleting something that is not empty is a **deliberate two-step**: without `mode` you get `409` and nothing changes.

=== "macOS / Linux"

    ```bash
    --8<-- "docs/api/examples/cookbook.sh:cleanup"
    ```

=== "Windows PowerShell"

    ```powershell
    --8<-- "docs/api/examples/cookbook.ps1:cleanup"
    ```
