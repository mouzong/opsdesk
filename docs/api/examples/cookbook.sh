#!/usr/bin/env bash
# OpsDesk API cookbook - a runnable walk through every API operation, using curl and jq.
# Requires: bash, curl >= 7.76, jq. Run it against a SCRATCH server: it creates and removes demo data.
#   export OPSDESK_API_TOKEN=...        (never type the token on the command line)
#   export BASE=http://127.0.0.1:4310/api/v1
#   bash docs/api/examples/cookbook.sh
# Destructive demos (replace import, restore) only run when COOKBOOK_ALLOW_REPLACE=1.
set -euo pipefail
# Do NOT enable "set -x" / "bash -x" while the token is in use: it would print it.

# --8<-- [start:setup]
BASE="${BASE:-http://127.0.0.1:4310/api/v1}"
: "${OPSDESK_API_TOKEN:?Set OPSDESK_API_TOKEN first (see Authentication)}"

# Keep the token out of the process list and the shell history: put the header in a private temp file.
AUTHFILE="$(mktemp)"; chmod 600 "$AUTHFILE"; trap 'rm -f "$AUTHFILE"' EXIT
printf 'Authorization: Bearer %s\n' "$OPSDESK_API_TOKEN" > "$AUTHFILE"

# api    : any request; --fail-with-body exits non-zero on HTTP errors but still prints the error JSON
# apij   : same, with a JSON request body header
api()  { curl --silent --show-error --fail-with-body -H @"$AUTHFILE" "$@"; }
apij() { api -H 'Content-Type: application/json' "$@"; }
# code   : print only the HTTP status code (for demonstrating expected failures)
code() { curl --silent --output /dev/null --write-out '%{http_code}' -H @"$AUTHFILE" "$@"; }
# --8<-- [end:setup]

WORK="$(mktemp -d)"; trap 'rm -f "$AUTHFILE"; rm -rf "$WORK"' EXIT
step() { printf '\n== %s\n' "$1"; }
expect() { [ "$1" = "$2" ] || { echo "FAILED: expected $2, got $1 ($3)"; exit 1; }; }

step "1. Health, version and capabilities (no token needed)"
# --8<-- [start:health]
curl --silent "$BASE/health" | jq '{status, version, engine: .checks.database.type, migrations: .checks.migrations.pending}'
curl --silent "$BASE/version" | jq .
curl --silent "$BASE/capabilities" | jq '{engine, authentication, features}'
# --8<-- [end:health]
FILE_BACKUPS=$(curl --silent "$BASE/capabilities" | jq -r .features.fileBackups)

step "2. Create a workspace and read it back"
# --8<-- [start:create-workspace]
WS=$(apij -X POST "$BASE/workspaces" -d '{"name":"Cookbook demo","icon":"rocket"}' | jq -r .id)
echo "workspace id: $WS"
# --8<-- [end:create-workspace]
# --8<-- [start:read-workspaces]
api "$BASE/workspaces?limit=10&sort=name" | jq '.page, [.items[] | {id, name, groupCount, bookmarkCount}]'
api "$BASE/workspaces/$WS" | jq '{id, name, icon, groups: (.groups | length)}'
# --8<-- [end:read-workspaces]

step "3. Create a group in the workspace"
# --8<-- [start:create-group]
GRP=$(apij -X POST "$BASE/workspaces/$WS/groups" -d '{"name":"Elastic Stack"}' | jq -r .id)
GRP2=$(apij -X POST "$BASE/workspaces/$WS/groups" -d '{"name":"Metrics"}' | jq -r .id)
echo "groups: $GRP $GRP2"
api "$BASE/groups?workspaceId=$WS" | jq '[.items[] | {id, name, position, bookmarkCount}]'
# --8<-- [end:create-group]

step "4. Create bookmarks"
# --8<-- [start:create-bookmark]
BM=$(apij -X POST "$BASE/groups/$GRP/bookmarks" -d '{
  "title": "Kibana",
  "url": "https://kibana.example.org:5601/app/discover",
  "description": "Log search",
  "environment": "production",
  "owner": "Observability",
  "icon": "search",
  "tags": ["elastic", "logs"],
  "note": "Start with the ops-logs-* data view."
}' | jq -r .id)
BM2=$(apij -X POST "$BASE/groups/$GRP/bookmarks" -d '{"title":"APM","url":"https://apm.example.org/","environment":"staging","tags":["elastic","apm"]}' | jq -r .id)
echo "bookmarks: $BM $BM2"
# --8<-- [end:create-bookmark]

step "5. Retrieve and search"
# --8<-- [start:search]
api "$BASE/bookmarks/$BM" | jq '{id, title, url, environment, favorite, tags}'

# search this workspace; terms are ANDed, case-insensitive, over title, description, URL, tags, owner
api -G "$BASE/bookmarks" --data-urlencode "q=KIBANA logs" --data-urlencode "workspaceId=$WS" | jq '[.items[] | .title], .page'

# filters combine: environment (any of), tag (all of), favorite, sort, pagination
api -G "$BASE/bookmarks" -d "workspaceId=$WS" -d 'environment=production,staging' -d 'tag=elastic' \
    -d 'sort=title' -d 'order=desc' -d 'limit=1' -d 'offset=0' | jq '[.items[] | .title], .page'

# omit workspaceId to search ALL workspaces
api -G "$BASE/bookmarks" --data-urlencode 'q=apm' | jq '.page.total'
api "$BASE/tags" | jq '[.items[] | "\(.tag)=\(.count)"]'
api "$BASE/environments" | jq '[.items[] | "\(.value)=\(.bookmarkCount)"]'
# --8<-- [end:search]

step "6. Edit, favorite, duplicate, move and reorder a bookmark"
# --8<-- [start:edit]
apij -X PATCH "$BASE/bookmarks/$BM" -d '{"title":"Kibana (prod)","tags":["elastic","logs","prod"]}' | jq '{title, tags}'
# --8<-- [end:edit]
# --8<-- [start:favorite]
apij -X PATCH "$BASE/bookmarks/$BM" -d '{"favorite":true}'  | jq .favorite     # pin / favorite
apij -X PATCH "$BASE/bookmarks/$BM" -d '{"favorite":false}' | jq .favorite     # unpin / unfavorite
api -G "$BASE/bookmarks" -d 'favorite=true' | jq '.page.total'                 # list pinned bookmarks
# --8<-- [end:favorite]
# --8<-- [start:duplicate]
COPY=$(api -X POST "$BASE/bookmarks/$BM/duplicate" | jq -r .id)
echo "copy: $COPY"
# --8<-- [end:duplicate]
# --8<-- [start:move]
# move to another group (index 0 = first position) ...
apij -X POST "$BASE/bookmarks/$COPY/move" -d "{\"groupId\":\"$GRP2\",\"index\":0}" | jq .
# ... or reorder inside the same group
apij -X POST "$BASE/bookmarks/$BM2/move" -d "{\"groupId\":\"$GRP\",\"index\":0}" | jq .
api "$BASE/groups/$GRP" | jq '[.bookmarks[] | .title]'
# --8<-- [end:move]
# --8<-- [start:group-workspace-ops]
apij -X PATCH "$BASE/groups/$GRP2" -d '{"name":"Metrics & dashboards","collapsed":true}' | jq '{name, collapsed}'
apij -X POST  "$BASE/groups/$GRP2/move" -d '{"index":0}' | jq .            # reorder groups
apij -X PATCH "$BASE/workspaces/$WS" -d '{"name":"Cookbook demo (renamed)"}' | jq .name
apij -X POST  "$BASE/workspaces/$WS/move" -d '{"index":0}' | jq .          # reorder workspaces
# --8<-- [end:group-workspace-ops]
expect "$(api "$BASE/groups/$GRP2" | jq -r '.bookmarks[0].title')" "Kibana (prod) (copy)" "moved bookmark"

step "7. Lost-update protection (ETag / If-Match) and safe retries (Idempotency-Key)"
# --8<-- [start:conditional]
ETAG=$(api --dump-header - --output /dev/null "$BASE/bookmarks/$BM" | awk -F': ' 'tolower($1)=="etag"{print $2}' | tr -d '\r')
echo "etag: $ETAG"
apij -X PATCH "$BASE/bookmarks/$BM" -H "If-Match: $ETAG" -d '{"owner":"Platform"}' | jq .owner      # succeeds
# the same (now stale) validator is refused with 412 and nothing changes:
code -X PATCH "$BASE/bookmarks/$BM" -H "If-Match: $ETAG" -H 'Content-Type: application/json' -d '{"owner":"Someone else"}'; echo
# --8<-- [end:conditional]
expect "$(code -X PATCH "$BASE/bookmarks/$BM" -H "If-Match: $ETAG" -H 'Content-Type: application/json' -d '{"owner":"x"}')" 412 "stale If-Match"
# --8<-- [start:idempotency]
KEY="cookbook-$(date +%s)-$RANDOM"
A=$(apij -X POST "$BASE/workspaces" -H "Idempotency-Key: $KEY" -d '{"name":"Cookbook retry demo"}' | jq -r .id)
B=$(apij -X POST "$BASE/workspaces" -H "Idempotency-Key: $KEY" -d '{"name":"Cookbook retry demo"}' | jq -r .id)
[ "$A" = "$B" ] && echo "retry replayed the first response: $A"
# --8<-- [end:idempotency]
expect "$A" "$B" "idempotent replay"
api -X DELETE "$BASE/workspaces/$A" | jq .

step "8. Recently opened: record, list, clear"
# --8<-- [start:recent]
api -X POST "$BASE/bookmarks/$BM/opened" | jq .          # records an opening; the server never launches a browser
api "$BASE/recent?limit=5" | jq '[.items[] | {title, openCount, lastOpenedAt}]'
api -X DELETE "$BASE/recent" | jq .                      # clear the history
# --8<-- [end:recent]
expect "$(api "$BASE/recent" | jq '.items | length')" 0 "recent cleared"

step "9. Settings (the only server-side preference is the dashboard title)"
# --8<-- [start:settings]
OLD_TITLE=$(api "$BASE/settings" | jq -r .title)
apij -X PATCH "$BASE/settings" -d '{"title":"Cookbook title"}' | jq .
apij -X PATCH "$BASE/settings" -d "$(jq -n --arg t "$OLD_TITLE" '{title:$t}')" | jq .
# --8<-- [end:settings]

step "10. Export"
# --8<-- [start:export]
api "$BASE/export" --output "$WORK/export.json"        # download as a file
jq '{format, version, workspaces: (.workspaces | length)}' "$WORK/export.json"
# --8<-- [end:export]

step "11. Import preview (changes nothing), then merge"
# --8<-- [start:import-merge]
# build a small import document: one new bookmark in an existing group, one duplicate
jq -n --arg ws "Cookbook demo (renamed)" '{
  format: "opsdesk-export", version: 1,
  workspaces: [{ name: $ws, icon: "rocket", groups: [{ name: "Elastic Stack", collapsed: false, bookmarks: [
    { title: "Prometheus", url: "https://prometheus.example.org:9090/", environment: "production", tags: ["metrics"] },
    { title: "Kibana again", url: "https://kibana.example.org:5601/app/discover" } ] }] }]
}' > "$WORK/merge.json"

# 1) JSON body (the file content goes into "data")
jq -n --slurpfile doc "$WORK/merge.json" '{source:"json", mode:"merge", duplicates:"skip", data:$doc[0]}' > "$WORK/merge-request.json"
apij -X POST "$BASE/import/preview" --data-binary @"$WORK/merge-request.json" | jq '.counts | {bookmarksAdded, bookmarksSkipped}'

# 2) multipart upload (no quoting problems): curl builds the form
api -X POST "$BASE/import/preview" -F "file=@$WORK/merge.json" -F mode=merge -F duplicates=skip | jq '.sample'

# apply the merge (a safety backup is created first; retry-safe with an Idempotency-Key)
api -X POST "$BASE/import/apply" -H "Idempotency-Key: cookbook-merge-$RANDOM$RANDOM" \
    -F "file=@$WORK/merge.json" -F mode=merge -F duplicates=skip | jq '{backup, added: .preview.counts.bookmarksAdded}'
# --8<-- [end:import-merge]
expect "$(api -G "$BASE/bookmarks" --data-urlencode 'q=prometheus' -d "workspaceId=$WS" | jq '.page.total')" 1 "merged bookmark"

step "12. Browser bookmarks (HTML) import"
# --8<-- [start:import-html]
cat > "$WORK/bookmarks.html" <<'HTML'
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Runbooks</H3>
  <DL><p>
    <DT><A HREF="https://wiki.example.org/n2/runbooks">N2 runbooks</A>
    <DT><A HREF="javascript:alert(1)">ignored: not http(s)</A>
  </DL><p>
</DL><p>
HTML
api -X POST "$BASE/import/preview" -F "file=@$WORK/bookmarks.html" -F "workspaceName=Cookbook HTML import" | jq '{warnings, counts: (.counts | {workspacesAdded, bookmarksAdded})}'
api -X POST "$BASE/import/apply"   -F "file=@$WORK/bookmarks.html" -F "workspaceName=Cookbook HTML import" | jq '.preview.counts.bookmarksAdded'
# --8<-- [end:import-html]

step "13. Protected replace import"
# --8<-- [start:import-replace]
# Replace DELETES everything first. Without the explicit flag it is refused and nothing changes:
code -X POST "$BASE/import/apply" -F "file=@$WORK/export.json" -F mode=replace; echo      # -> 400 confirmation_required
# Only with "confirmReplace=true" (a safety backup is created first):
#   api -X POST "$BASE/import/apply" -F "file=@export.json" -F mode=replace -F confirmReplace=true
# --8<-- [end:import-replace]
expect "$(code -X POST "$BASE/import/apply" -F "file=@$WORK/export.json" -F mode=replace)" 400 "replace needs confirmation"
if [ "${COOKBOOK_ALLOW_REPLACE:-0}" = "1" ]; then
  api -X POST "$BASE/import/apply" -F "file=@$WORK/export.json" -F mode=replace -F confirmReplace=true | jq '{backup, removed: .preview.counts.workspacesRemoved}'
  # the replace restored the exported state: re-read the ids of the demo workspace
  WS=$(api -G "$BASE/workspaces" --data-urlencode 'q=Cookbook demo (renamed)' | jq -r '.items[0].id')
  GRP=$(api -G "$BASE/groups" -d "workspaceId=$WS" --data-urlencode 'q=Elastic' | jq -r '.items[0].id')
  GRP2=$(api -G "$BASE/groups" -d "workspaceId=$WS" --data-urlencode 'q=Metrics' | jq -r '.items[0].id')
  BM2=$(api -G "$BASE/bookmarks" -d "workspaceId=$WS" --data-urlencode 'q=apm' | jq -r '.items[0].id')
fi

step "14. Backups (SQLite only)"
if [ "$FILE_BACKUPS" = "true" ]; then
# --8<-- [start:backups]
NAME=$(api -X POST "$BASE/backups" | jq -r .name)                        # create
api "$BASE/backups?limit=5" | jq '[.items[] | {name, kind, sizeBytes}]'  # list metadata
api "$BASE/backups/$NAME" | jq .                                         # one backup
api "$BASE/backups/$NAME/download" --output "$NAME"                      # download the file
rm -f "$NAME"
# Restore is destructive: it needs {"confirm": true} and first saves the current data as a pre-restore backup.
#   apij -X POST "$BASE/backups/$NAME/restore" -d '{"confirm":true}'
api -X DELETE "$BASE/backups/$NAME" | jq .                               # delete the backup file
# --8<-- [end:backups]
else
  echo "(backups are not available on this database engine; use pg_dump / mysqldump)"
  expect "$(code "$BASE/backups")" 409 "backups unsupported"
fi

step "15. Inspect HTTP failures without losing the response body"
# --8<-- [start:errors]
# --fail-with-body: curl exits non-zero on HTTP >= 400 but still prints the JSON error.
api "$BASE/bookmarks/does-not-exist" || echo "(exit code $?, see the error JSON above)"
# Or keep body and status together:
curl --silent --write-out '\nHTTP %{http_code}\n' -H @"$AUTHFILE" -H 'Content-Type: application/json' \
     -X POST "$BASE/groups/$GRP/bookmarks" -d '{"title":"x","url":"javascript:alert(1)"}' | tee /dev/stderr >/dev/null
# the error body has code, message, field details and the request id:
#   {"error":{"code":"validation_error","message":"url: ...","fields":{"url":"..."},"requestId":"..."}}
# --8<-- [end:errors]
expect "$(code -X POST "$BASE/groups/$GRP/bookmarks" -H 'Content-Type: application/json' -d '{"title":"x","url":"javascript:alert(1)"}')" 400 "unsafe URL rejected"
expect "$(curl --silent --output /dev/null --write-out '%{http_code}' -X POST "$BASE/workspaces" -H 'Content-Type: application/json' -d '{"name":"no token"}' -H 'Authorization: Bearer wrong-token-wrong-token-wrong')" 401 "bad token"

step "16. Delete the example resources safely"
# --8<-- [start:cleanup]
# A non-empty group is refused until you choose what happens to its bookmarks (nothing is changed on 409):
code -X DELETE "$BASE/groups/$GRP"; echo                                   # -> 409 conflict
apij -X DELETE "$BASE/groups/$GRP2" -d "{\"mode\":\"move\",\"targetId\":\"$GRP\"}" | jq .   # move its bookmarks, then delete
api -X DELETE "$BASE/bookmarks/$BM2" | jq .                                # delete a single bookmark
apij -X DELETE "$BASE/groups/$GRP" -d '{"mode":"delete"}' | jq .           # delete the group and what is left in it
api -X DELETE "$BASE/workspaces/$WS" | jq .                                # the workspace is now empty
# the imported HTML workspace: query parameters work for DELETE too
HTML_WS=$(api -G "$BASE/workspaces" --data-urlencode 'q=Cookbook HTML import' | jq -r '.items[0].id // empty')
[ -z "$HTML_WS" ] || api -X DELETE "$BASE/workspaces/$HTML_WS?mode=delete" | jq .
# --8<-- [end:cleanup]
# demonstrate the 409 first (needs a non-empty group), so the check above is meaningful:
expect "$(api -G "$BASE/workspaces" --data-urlencode 'q=Cookbook' | jq '.page.total')" 0 "everything cleaned up"
echo
echo "COOKBOOK OK"
