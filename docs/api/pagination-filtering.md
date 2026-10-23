# Pagination, filtering and sorting

## Pagination

Collections that can grow are paginated with `limit` and `offset`:

| Parameter | Default | Range | Meaning |
| --- | --- | --- | --- |
| `limit` | `50` | 1-200 | Items per page |
| `offset` | `0` | 0-1 000 000 | Items to skip |

```json
{
  "items": [ { "id": "3f0c9d52-0000-4000-8000-000000000001", "name": "Observability", "position": 0, "groupCount": 2, "bookmarkCount": 6 } ],
  "page": { "limit": 50, "offset": 0, "total": 1, "hasMore": false }
}
```

Loop until `hasMore` is `false`, increasing `offset` by `limit`:

```bash
offset=0
while :; do
  page=$(curl -s "$BASE/bookmarks?limit=100&offset=$offset")
  echo "$page" | jq -r '.items[].title'
  [ "$(echo "$page" | jq .page.hasMore)" = true ] || break
  offset=$((offset + 100))
done
```

Paginated: `GET /workspaces`, `/groups`, `/bookmarks`, `/tags`, `/backups`. Not paginated because they are small and bounded: `/recent` (`limit` 1-50), `/environments`, `/dashboard` (whole tree for the UI). Pages are consistent snapshots of a single request; if data changes between requests, items may shift (use the `If-Match`/ETag mechanism, not paging, for concurrency control).

## Bookmarks: `GET /bookmarks`

Search and filters combine with **AND**. This is the same logic as the UI search.

| Parameter | Type | Semantics |
| --- | --- | --- |
| `q` | string (max 200) | Split on whitespace; **every** term must appear, case-insensitively, in title, description, URL, tags or owner |
| `workspaceId` | id | Only this workspace. **Omit to search all workspaces** |
| `groupId` | id | Only this group |
| `environment` | comma list | Bookmark matches **any** listed environment (`production,preproduction`) |
| `tag` | comma list | Bookmark must have **all** listed tags (case-insensitive) |
| `favorite` | `true`/`false` | Only pinned / only unpinned |
| `sort` | `position` (default), `title`, `createdAt`, `updatedAt`, `lastOpenedAt`, `openCount` | `position` is display order (workspace, group, bookmark); `title` is case-insensitive; null `lastOpenedAt` sorts last |
| `order` | `asc` (default), `desc` | |
| `limit`, `offset` | | see above |

Each item is a bookmark plus `workspaceId`, `workspaceName` and `groupName`. This GET never records an opening.

```bash
curl -s -G "$BASE/bookmarks" --data-urlencode 'q=kibana logs' -d 'environment=production' -d 'tag=elastic' -d 'sort=title' -d 'limit=20'
```

Use `--data-urlencode` for free text (spaces, `&`, `#`).

## Other collections

| Endpoint | Filters | Sort |
| --- | --- | --- |
| `GET /workspaces` | `q` (name substring) | `sort=position\|name`, `order` |
| `GET /groups` | `workspaceId`, `q` (name substring) | `sort=position\|name`, `order` |
| `GET /tags` | `workspaceId`, `q` (substring) | most used first, then alphabetical |
| `GET /backups` | `kind=manual\|auto\|pre-import\|pre-restore\|other` | newest first |
| `GET /recent` | - | most recently opened first, `limit` 1-50 |

## Tags and environments

- **Tags** are free-form labels stored on bookmarks; there is no tag resource, no rename and no merge in the application. `GET /tags` lists them with counts. Change tags by editing a bookmark (`PATCH /bookmarks/{id}` with `"tags": [...]`, which replaces the list).
- **Environments** are a fixed enumeration. `GET /environments` lists the values with usage counts; each bookmark has exactly one.
