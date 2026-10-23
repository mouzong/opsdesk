# Import, export and engine transfers

## Export

Settings > **Export JSON** (or `GET /api/export`). The file is versioned (`"format": "opsdesk-export", "version": 1`) and nested workspaces > groups > bookmarks in display order.

| Included | Excluded |
| --- | --- |
| Dashboard title | "Recently opened" history and open counters |
| Workspaces: name, icon, order | "Sample" markers (imported items count as your own content) |
| Groups: name, collapsed state, order | Internal identifiers (new ones are generated on import) |
| Bookmarks: title, URL, description, environment, owner, icon, tags, favorite, note, created/modified timestamps, order | Browser-side preferences (theme, layout, sidebar - stored per browser) |
| | Database backups and anything outside OpsDesk's tables |

## Import

Settings > **Import**: an OpsDesk JSON export, or a bookmarks file exported from Chrome, Edge, Firefox or Safari (Netscape HTML). Files are parsed as data and never rendered. Limits: 5 MB, field lengths as in the forms, 50 workspaces, 100 groups per workspace, 20 000 bookmarks.

Every import shows an **exact preview** (the real import runs in a transaction that is rolled back) and, once applied, is **one transaction**: any failure leaves existing data untouched. A safety backup is created first ([Backup and restore](backup-restore.md#before-risky-operations)).

### Merge (default)

Workspaces match by name and groups by name within the workspace (case-insensitive); bookmarks match by **normalised URL within the same group**. For a match choose *keep existing (skip)* (default) or *update from file*. Everything else is appended in file order.

### Replace

Deletes all current workspaces, groups and bookmarks, then loads the file and its dashboard title. Requires an explicit confirmation.

### Browser bookmark files (HTML)

Merge-only, into a workspace you name; folders become groups (nested folders are joined as `A / B`); `javascript:`, `place:`, `file:` and other non-http(s) links are skipped and counted in the preview.

## Transferring data between database engines

There is **no automatic data migration**. The supported procedure:

1. **Old setup:** Settings > *Export JSON*. Also take a native backup of the old database; keep it until you have checked the result.
2. **Stop OpsDesk.** Change `OPSDESK_DB_CLIENT` / `OPSDESK_DATABASE_URL` in `.env` ([Databases](databases.md)) and start it. The new, empty database is migrated automatically; choose *Empty dashboard* on the welcome screen.
3. Settings > *Import* > the JSON file > **Replace** > confirm.
4. Compare, then retire the old database.

Verified: SQLite to PostgreSQL to SQLite and SQLite to MySQL to SQLite round trips produce **identical** exports (apart from `exportedAt`).
