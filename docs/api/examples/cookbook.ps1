# OpsDesk API cookbook for Windows PowerShell (5.1 or 7+). Uses curl.exe (ships with Windows 10+) and ConvertFrom-Json (no jq needed).
# Run it against a SCRATCH server: it creates and removes demo data.
#   $env:OPSDESK_API_TOKEN = Read-Host -MaskInput "API token"     # PowerShell 7; in 5.1 use: $env:OPSDESK_API_TOKEN = (Read-Host "API token")
#   $env:BASE = "http://127.0.0.1:4310/api/v1"
#   .\docs\api\examples\cookbook.ps1
# NOTE: this PowerShell version was written to mirror cookbook.sh but has NOT been executed in the OpsDesk test environment.
$ErrorActionPreference = 'Stop'
# Never run Set-PSDebug -Trace or Start-Transcript while the token is in use.

# --8<-- [start:setup]
$Base = if ($env:BASE) { $env:BASE } else { 'http://127.0.0.1:4310/api/v1' }
if (-not $env:OPSDESK_API_TOKEN) { throw 'Set $env:OPSDESK_API_TOKEN first (see Authentication).' }

# Keep the token out of the process list: put the header into a private temp file and let curl read it (-H @file).
$AuthFile = New-TemporaryFile
[IO.File]::WriteAllText($AuthFile.FullName, "Authorization: Bearer $($env:OPSDESK_API_TOKEN)`n")

# Api      : any curl.exe request; --fail-with-body returns a non-zero exit code on HTTP errors but still prints the error JSON
# ApiJson  : sends a JSON string as a request-body FILE (avoids PowerShell/curl quoting problems) and parses the answer
function Api { curl.exe --silent --show-error --fail-with-body -H "@$($AuthFile.FullName)" @args }
function ApiJson([string]$Method, [string]$Url, [string]$Json, [string[]]$Extra = @()) {
  $body = New-TemporaryFile
  [IO.File]::WriteAllText($body.FullName, $Json)
  try { Api -X $Method -H 'Content-Type: application/json' @Extra --data-binary "@$($body.FullName)" $Url | ConvertFrom-Json }
  finally { Remove-Item $body -Force }
}
function Code { curl.exe --silent --output NUL --write-out '%{http_code}' -H "@$($AuthFile.FullName)" @args }
# --8<-- [end:setup]

$Work = Join-Path ([IO.Path]::GetTempPath()) ("opsdesk-cookbook-" + [guid]::NewGuid())
New-Item -ItemType Directory $Work | Out-Null
function Step($t) { Write-Host "`n== $t" }

try {
Step '1. Health, version and capabilities (no token needed)'
# --8<-- [start:health]
$h = curl.exe --silent "$Base/health" | ConvertFrom-Json
"$($h.status) v$($h.version) on $($h.checks.database.type)"
curl.exe --silent "$Base/version" | ConvertFrom-Json
curl.exe --silent "$Base/capabilities" | ConvertFrom-Json | Select-Object -ExpandProperty features
# --8<-- [end:health]
$fileBackups = (curl.exe --silent "$Base/capabilities" | ConvertFrom-Json).features.fileBackups

Step '2. Create a workspace and read it back'
# --8<-- [start:create-workspace]
$ws = (ApiJson POST "$Base/workspaces" '{"name":"Cookbook demo","icon":"rocket"}').id
"workspace id: $ws"
# --8<-- [end:create-workspace]
# --8<-- [start:read-workspaces]
(Api "$Base/workspaces?limit=10&sort=name" | ConvertFrom-Json).items | Select-Object id, name, groupCount, bookmarkCount
Api "$Base/workspaces/$ws" | ConvertFrom-Json | Select-Object id, name, icon
# --8<-- [end:read-workspaces]

Step '3. Create a group in the workspace'
# --8<-- [start:create-group]
$grp  = (ApiJson POST "$Base/workspaces/$ws/groups" '{"name":"Elastic Stack"}').id
$grp2 = (ApiJson POST "$Base/workspaces/$ws/groups" '{"name":"Metrics"}').id
(Api "$Base/groups?workspaceId=$ws" | ConvertFrom-Json).items | Select-Object id, name, position, bookmarkCount
# --8<-- [end:create-group]

Step '4. Create bookmarks'
# --8<-- [start:create-bookmark]
$bm = (ApiJson POST "$Base/groups/$grp/bookmarks" (@{
  title = 'Kibana'; url = 'https://kibana.example.org:5601/app/discover'; description = 'Log search'
  environment = 'production'; owner = 'Observability'; icon = 'search'; tags = @('elastic', 'logs')
  note = 'Start with the ops-logs-* data view.'
} | ConvertTo-Json)).id
$bm2 = (ApiJson POST "$Base/groups/$grp/bookmarks" '{"title":"APM","url":"https://apm.example.org/","environment":"staging","tags":["elastic","apm"]}').id
# --8<-- [end:create-bookmark]

Step '5. Retrieve and search'
# --8<-- [start:search]
Api "$Base/bookmarks/$bm" | ConvertFrom-Json | Select-Object id, title, url, environment, favorite
# terms are ANDed, case-insensitive; --get + --data-urlencode builds a safe query string
$r = Api --get "$Base/bookmarks" --data-urlencode 'q=KIBANA logs' --data-urlencode "workspaceId=$ws" | ConvertFrom-Json
$r.items.title; $r.page
# filters: environment (any of), tag (all of), favorite, sort, pagination. Omit workspaceId to search ALL workspaces.
Api --get "$Base/bookmarks" -d "workspaceId=$ws" -d 'environment=production,staging' -d 'tag=elastic' -d 'sort=title' -d 'order=desc' -d 'limit=1' | ConvertFrom-Json
(Api "$Base/tags" | ConvertFrom-Json).items
(Api "$Base/environments" | ConvertFrom-Json).items
# --8<-- [end:search]

Step '6. Edit, favorite, duplicate, move and reorder a bookmark'
# --8<-- [start:edit]
ApiJson PATCH "$Base/bookmarks/$bm" '{"title":"Kibana (prod)","tags":["elastic","logs","prod"]}' | Select-Object title, tags
# --8<-- [end:edit]
# --8<-- [start:favorite]
(ApiJson PATCH "$Base/bookmarks/$bm" '{"favorite":true}').favorite     # pin / favorite
(ApiJson PATCH "$Base/bookmarks/$bm" '{"favorite":false}').favorite    # unpin / unfavorite
(Api --get "$Base/bookmarks" -d 'favorite=true' | ConvertFrom-Json).page.total
# --8<-- [end:favorite]
# --8<-- [start:duplicate]
$copy = (Api -X POST "$Base/bookmarks/$bm/duplicate" | ConvertFrom-Json).id
# --8<-- [end:duplicate]
# --8<-- [start:move]
ApiJson POST "$Base/bookmarks/$copy/move" "{`"groupId`":`"$grp2`",`"index`":0}"    # move to another group
ApiJson POST "$Base/bookmarks/$bm2/move"  "{`"groupId`":`"$grp`",`"index`":0}"     # reorder inside a group
(Api "$Base/groups/$grp" | ConvertFrom-Json).bookmarks.title
# --8<-- [end:move]
# --8<-- [start:group-workspace-ops]
ApiJson PATCH "$Base/groups/$grp2" '{"name":"Metrics & dashboards","collapsed":true}' | Select-Object name, collapsed
ApiJson POST  "$Base/groups/$grp2/move" '{"index":0}'
ApiJson PATCH "$Base/workspaces/$ws" '{"name":"Cookbook demo (renamed)"}' | Select-Object name
ApiJson POST  "$Base/workspaces/$ws/move" '{"index":0}'
# --8<-- [end:group-workspace-ops]

Step '7. Lost-update protection (ETag / If-Match) and safe retries (Idempotency-Key)'
# --8<-- [start:conditional]
$etag = ((Api --dump-header - --output NUL "$Base/bookmarks/$bm") | Select-String -Pattern '^etag:\s*(.+)$' -CaseSensitive:$false).Matches[0].Groups[1].Value.Trim()
ApiJson PATCH "$Base/bookmarks/$bm" '{"owner":"Platform"}' @('-H', "If-Match: $etag") | Select-Object owner   # succeeds
# the same (now stale) validator is refused with 412:
$body = New-TemporaryFile; [IO.File]::WriteAllText($body.FullName, '{"owner":"Someone else"}')
Code -X PATCH -H "If-Match: $etag" -H 'Content-Type: application/json' --data-binary "@$($body.FullName)" "$Base/bookmarks/$bm"
# --8<-- [end:conditional]
# --8<-- [start:idempotency]
$key = "cookbook-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())-$(Get-Random)"
$a = (ApiJson POST "$Base/workspaces" '{"name":"Cookbook retry demo"}' @('-H', "Idempotency-Key: $key")).id
$b = (ApiJson POST "$Base/workspaces" '{"name":"Cookbook retry demo"}' @('-H', "Idempotency-Key: $key")).id
"retry replayed the first response: $($a -eq $b)"
Api -X DELETE "$Base/workspaces/$a" | Out-Null
# --8<-- [end:idempotency]

Step '8. Recently opened: record, list, clear'
# --8<-- [start:recent]
Api -X POST "$Base/bookmarks/$bm/opened"          # records an opening; the server never launches a browser
(Api "$Base/recent?limit=5" | ConvertFrom-Json).items | Select-Object title, openCount, lastOpenedAt
Api -X DELETE "$Base/recent"                      # clear the history
# --8<-- [end:recent]

Step '9. Settings (the only server-side preference is the dashboard title)'
# --8<-- [start:settings]
$old = (Api "$Base/settings" | ConvertFrom-Json).title
ApiJson PATCH "$Base/settings" '{"title":"Cookbook title"}'
ApiJson PATCH "$Base/settings" (@{ title = $old } | ConvertTo-Json)
# --8<-- [end:settings]

Step '10. Export'
# --8<-- [start:export]
Api "$Base/export" --output "$Work\export.json"
(Get-Content "$Work\export.json" -Raw | ConvertFrom-Json) | Select-Object format, version
# --8<-- [end:export]

Step '11. Import preview (changes nothing), then merge'
# --8<-- [start:import-merge]
$doc = @{
  format = 'opsdesk-export'; version = 1
  workspaces = @(@{ name = 'Cookbook demo (renamed)'; icon = 'rocket'; groups = @(@{ name = 'Elastic Stack'; collapsed = $false; bookmarks = @(
    @{ title = 'Prometheus'; url = 'https://prometheus.example.org:9090/'; environment = 'production'; tags = @('metrics') },
    @{ title = 'Kibana again'; url = 'https://kibana.example.org:5601/app/discover' }) }) })
} | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText("$Work\merge.json", $doc)

# multipart upload: curl builds the form, no quoting problems
(Api -X POST "$Base/import/preview" -F "file=@$Work\merge.json" -F mode=merge -F duplicates=skip | ConvertFrom-Json).counts
# apply the merge (a safety backup is created first; retry-safe with an Idempotency-Key)
Api -X POST "$Base/import/apply" -H "Idempotency-Key: cookbook-merge-$(Get-Random)" -F "file=@$Work\merge.json" -F mode=merge -F duplicates=skip | ConvertFrom-Json | Select-Object backup
# --8<-- [end:import-merge]

Step '12. Browser bookmarks (HTML) import'
# --8<-- [start:import-html]
$html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Runbooks</H3><DL><p><DT><A HREF="https://wiki.example.org/n2/runbooks">N2 runbooks</A></DL><p></DL><p>'
[IO.File]::WriteAllText("$Work\bookmarks.html", $html)
Api -X POST "$Base/import/preview" -F "file=@$Work\bookmarks.html" -F 'workspaceName=Cookbook HTML import' | ConvertFrom-Json | Select-Object warnings
Api -X POST "$Base/import/apply"   -F "file=@$Work\bookmarks.html" -F 'workspaceName=Cookbook HTML import' | Out-Null
# --8<-- [end:import-html]

Step '13. Protected replace import'
# --8<-- [start:import-replace]
# Replace DELETES everything first. Without the explicit flag it is refused (HTTP 400) and nothing changes:
Code -X POST "$Base/import/apply" -F "file=@$Work\export.json" -F mode=replace
# Only with confirmReplace=true (a safety backup is created first):
#   Api -X POST "$Base/import/apply" -F "file=@export.json" -F mode=replace -F confirmReplace=true
# --8<-- [end:import-replace]

Step '14. Backups (SQLite only)'
if ($fileBackups) {
# --8<-- [start:backups]
$name = (Api -X POST "$Base/backups" | ConvertFrom-Json).name                 # create
(Api "$Base/backups?limit=5" | ConvertFrom-Json).items | Select-Object name, kind, sizeBytes
Api "$Base/backups/$name" | ConvertFrom-Json                                  # one backup
Api "$Base/backups/$name/download" --output $name                             # download the file
Remove-Item $name
# Restore is destructive: it needs {"confirm": true}.   ApiJson POST "$Base/backups/$name/restore" '{"confirm":true}'
Api -X DELETE "$Base/backups/$name" | Out-Null
# --8<-- [end:backups]
}

Step '15. Inspect HTTP failures without losing the response body'
# --8<-- [start:errors]
# --fail-with-body: curl.exe exits non-zero on HTTP >= 400 ($LASTEXITCODE = 22) but still prints the JSON error.
Api "$Base/bookmarks/does-not-exist"; "exit code: $LASTEXITCODE"
# keep body and status code together:
curl.exe --silent --write-out "`nHTTP %{http_code}`n" -H "@$($AuthFile.FullName)" -H 'Content-Type: application/json' -X POST "$Base/groups/$grp/bookmarks" --data-binary '{"title":"x","url":"javascript:alert(1)"}'
# the error body has code, message, field details and the request id
# --8<-- [end:errors]

Step '16. Delete the example resources safely'
# --8<-- [start:cleanup]
Code -X DELETE "$Base/groups/$grp"                                             # 409: non-empty group needs mode=move or mode=delete
ApiJson DELETE "$Base/groups/$grp2" "{`"mode`":`"move`",`"targetId`":`"$grp`"}"   # move its bookmarks, then delete
Api -X DELETE "$Base/bookmarks/$bm2" | Out-Null
ApiJson DELETE "$Base/groups/$grp" '{"mode":"delete"}'
Api -X DELETE "$Base/workspaces/$ws" | Out-Null
$htmlWs = ((Api --get "$Base/workspaces" --data-urlencode 'q=Cookbook HTML import' | ConvertFrom-Json).items | Select-Object -First 1).id
if ($htmlWs) { Api -X DELETE "$Base/workspaces/${htmlWs}?mode=delete" | Out-Null }   # query parameters work for DELETE too
# --8<-- [end:cleanup]
'COOKBOOK OK'
}
finally {
  Remove-Item $AuthFile -Force -ErrorAction SilentlyContinue
  Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue
}
