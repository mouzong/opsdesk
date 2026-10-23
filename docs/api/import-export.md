# Import and export over the API

The portable format and the merge rules are the same as in the UI: see [Import, export and engine transfers](../operations/import-export.md). This page covers the HTTP side.

## Export

```bash
curl -s "$BASE/export" -o opsdesk-export.json          # attachment: opsdesk-export-<timestamp>.json
jq '{format, version, workspaces: (.workspaces | length)}' opsdesk-export.json
```

`GET /export` is a read (no token needed on localhost). The file excludes recently-opened history, sample markers and identifiers.

## Preview, merge and replace

| Operation | Endpoint | Changes data? |
| --- | --- | --- |
| Preview | `POST /import/preview` | **No** - the real import runs in a transaction that is always rolled back |
| Apply (merge) | `POST /import/apply` with `mode: "merge"` (default) | Yes - adds to the dashboard |
| Apply (replace) | `POST /import/apply` with `mode: "replace"` **and `"confirmReplace": true`** | Yes - **deletes everything first** |

- A **safety backup** is created before every apply (`backup` in the response): SQLite `pre-import-*.sqlite`, PostgreSQL/MySQL `pre-import-*.json`.
- The import is **one transaction**: any failure (invalid file, limit, error halfway) leaves existing data untouched.
- Replace without `confirmReplace: true` is refused with `400 confirmation_required` before anything happens.
- `duplicates`: `skip` keeps an existing bookmark (same URL in the same group), `update` overwrites it from the file.
- Browser HTML imports are merge-only, into `workspaceName` (default "Imported bookmarks"); non-http(s) links are skipped and reported in `warnings`.
- Limits: 5 MB file, 50 workspaces, 100 groups per workspace, 20 000 bookmarks in total.

## Request styles

=== "JSON body"

    ```bash
    # source "json": the export document goes into "data"
    jq -n --slurpfile doc opsdesk-export.json '{source:"json", mode:"merge", duplicates:"skip", data:$doc[0]}' > request.json
    curl -s -X POST "$BASE/import/preview" -H @/tmp/od-auth -H 'Content-Type: application/json' --data-binary @request.json | jq .counts

    # source "html": the file content goes into "html"
    jq -n --rawfile h bookmarks.html '{source:"html", workspaceName:"From Chrome", html:$h}' > request.json
    ```

=== "Multipart upload"

    ```bash
    curl -s -X POST "$BASE/import/preview" -H @/tmp/od-auth -F file=@opsdesk-export.json -F mode=merge -F duplicates=skip | jq .
    curl -s -X POST "$BASE/import/apply"   -H @/tmp/od-auth -F file=@bookmarks.html -F workspaceName='From Chrome' | jq .
    ```

    Fields: `file` (required), `mode`, `duplicates`, `confirmReplace` (`true`), `workspaceName` (HTML), `source` (`json`/`html`, otherwise detected from the content). **Multipart needs the bearer token**; the web UI uses JSON.

## Examples

```json title="Merge, update existing duplicates"
{ "source": "json", "mode": "merge", "duplicates": "update",
  "data": { "format": "opsdesk-export", "version": 1,
    "workspaces": [ { "name": "Observability", "groups": [ { "name": "Elastic Stack", "bookmarks": [
      { "title": "APM", "url": "https://apm.example.org/" } ] } ] } ] } }
```

```json title="Replace (destructive) - needs confirmReplace"
{ "source": "json", "mode": "replace", "confirmReplace": true, "data": { "format": "opsdesk-export", "version": 1, "workspaces": [] } }
```

```json title="Preview response (abridged)"
{ "source": "json", "mode": "merge", "duplicates": "skip",
  "counts": { "workspacesAdded": 0, "workspacesExisting": 1, "groupsAdded": 0, "groupsExisting": 1,
              "bookmarksAdded": 1, "bookmarksUpdated": 0, "bookmarksSkipped": 0,
              "workspacesRemoved": 0, "groupsRemoved": 0, "bookmarksRemoved": 0 },
  "titleChange": null, "warnings": [], "sample": ["+ \"APM\" in Observability / Elastic Stack"] }
```

## Backups

`GET /backups`, `POST /backups`, `GET /backups/{name}`, `GET /backups/{name}/download`, `POST /backups/{name}/restore` (needs `{"confirm": true}`), `DELETE /backups/{name}`: **SQLite only** (`409 not_supported` otherwise). Names are validated and confined to the backups folder; there is no way to read or write other files. Examples: [cookbook, section 14](cookbook.md#14-backups-sqlite).
