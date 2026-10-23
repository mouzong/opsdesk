import { routes } from './routes.js';

/** Every operation the web UI offers and the API operation(s) that perform it. Tests fail if an operationId here does not exist. */
export const UI_COVERAGE: { area: string; operation: string; operationIds: string[]; note?: string }[] = [
  { area: 'Workspaces', operation: 'Load the dashboard', operationIds: ['getDashboard'], note: 'Paginated alternatives: listWorkspaces, listGroups, listBookmarks.' },
  { area: 'Workspaces', operation: 'List / open a workspace', operationIds: ['listWorkspaces', 'getWorkspace'] },
  { area: 'Workspaces', operation: 'Create a workspace', operationIds: ['createWorkspace'] },
  { area: 'Workspaces', operation: 'Rename a workspace / change its icon', operationIds: ['updateWorkspace'] },
  { area: 'Workspaces', operation: 'Reorder workspaces (move up/down)', operationIds: ['moveWorkspace'] },
  { area: 'Workspaces', operation: 'Delete a workspace (move or delete its groups)', operationIds: ['deleteWorkspace'] },
  { area: 'Groups', operation: 'List / read groups', operationIds: ['listGroups', 'getGroup'] },
  { area: 'Groups', operation: 'Create a group', operationIds: ['createGroup'] },
  { area: 'Groups', operation: 'Rename a group; collapse / expand it', operationIds: ['updateGroup'] },
  { area: 'Groups', operation: 'Reorder a group (drag or menu)', operationIds: ['moveGroup'] },
  { area: 'Groups', operation: 'Move a group to another workspace', operationIds: ['moveGroup'] },
  { area: 'Groups', operation: 'Delete a group (move or delete its bookmarks)', operationIds: ['deleteGroup'] },
  { area: 'Bookmarks', operation: 'Add a bookmark (optionally into a new group)', operationIds: ['createBookmark', 'createGroup'] },
  { area: 'Bookmarks', operation: 'View details, note and URL; copy URL', operationIds: ['getBookmark'], note: 'Copying to the clipboard is client-side; the API returns the URL.' },
  { area: 'Bookmarks', operation: 'Edit a bookmark', operationIds: ['updateBookmark'] },
  { area: 'Bookmarks', operation: 'Pin / unpin (favorite / unfavorite)', operationIds: ['updateBookmark'], note: 'Pin and favorite are the same field: `favorite`.' },
  { area: 'Bookmarks', operation: 'Duplicate a bookmark', operationIds: ['duplicateBookmark'] },
  { area: 'Bookmarks', operation: 'Move a bookmark to another group or workspace', operationIds: ['moveBookmark'] },
  { area: 'Bookmarks', operation: 'Reorder bookmarks (drag, earlier/later)', operationIds: ['moveBookmark'] },
  { area: 'Bookmarks', operation: 'Delete a bookmark', operationIds: ['deleteBookmark'] },
  { area: 'Recent', operation: 'Open a bookmark (record the launch)', operationIds: ['recordBookmarkOpened'], note: 'The browser opens the link; the API only records it.' },
  { area: 'Recent', operation: 'Show "Recently opened"', operationIds: ['listRecent'] },
  { area: 'Search', operation: 'Search this workspace / all workspaces', operationIds: ['listBookmarks'] },
  { area: 'Search', operation: 'Filter by environment, tags, favorites; show "Pinned"', operationIds: ['listBookmarks', 'listTags', 'listEnvironments'] },
  { area: 'Search', operation: 'Command palette (jump to a bookmark or workspace)', operationIds: ['listBookmarks', 'listWorkspaces'] },
  { area: 'Settings', operation: 'Edit the dashboard title', operationIds: ['updateSettings', 'getSettings'] },
  { area: 'Settings', operation: 'First run: sample data or empty dashboard', operationIds: ['completeSetup'] },
  { area: 'Settings', operation: 'Remove sample data', operationIds: ['removeSampleData'] },
  { area: 'Settings', operation: 'Show version, About, active database engine', operationIds: ['getVersion', 'getCapabilities', 'getSession'] },
  { area: 'Import / export', operation: 'Export JSON', operationIds: ['exportDashboard'] },
  { area: 'Import / export', operation: 'Preview an import (JSON or browser HTML)', operationIds: ['previewImport'] },
  { area: 'Import / export', operation: 'Apply an import: merge or replace', operationIds: ['applyImport'] },
  { area: 'Backups', operation: 'List backups and their metadata', operationIds: ['listBackups', 'getBackup'] },
  { area: 'Backups', operation: 'Create a backup', operationIds: ['createBackup'] },
  { area: 'Backups', operation: 'Download a backup', operationIds: ['downloadBackup'] },
  { area: 'Backups', operation: 'Restore a backup', operationIds: ['restoreBackup'] },
  { area: 'Backups', operation: 'Delete a backup', operationIds: ['deleteBackup'] },
  { area: 'System', operation: 'Health', operationIds: ['getHealth'] },
];

/** API operations with no UI button (added for scripting). */
export const API_ONLY: { operation: string; operationIds: string[] }[] = [
  { operation: 'Clear the recently-opened history', operationIds: ['clearRecent'] },
  { operation: 'Machine-readable API contract', operationIds: ['getOpenApiDocument'] },
];

/** Browser-only behaviour that has no server counterpart, and why. */
export const NOT_APPLICABLE: { operation: string; reason: string }[] = [
  { operation: 'Theme, layout density, sidebar state, last workspace', reason: 'Stored in the browser (localStorage), not on the server.' },
  { operation: 'Workspace selection screen, routing, Back/Forward', reason: 'Client-side navigation.' },
  { operation: 'Drag and drop gesture', reason: 'The result of the gesture is a move/reorder call (see moveBookmark, moveGroup).' },
  { operation: 'Launching a URL in a new tab, copying to the clipboard', reason: 'Performed by the client; the server must not launch browsers. Read the URL with getBookmark.' },
  { operation: 'Documentation link', reason: 'Static documentation served under /docs/.' },
  { operation: 'Selecting the database engine, credentials, ports, data directory, API token, CORS origins', reason: 'Deployment configuration: deliberately outside the writable API (read-only engine info via getCapabilities).' },
];

const find = (id: string) => routes.find((r) => r.operationId === id);
const endpoint = (id: string) => {
  const r = find(id);
  return r ? `\`${r.method.toUpperCase()} ${r.path}\`` : `**MISSING ${id}**`;
};

/** Markdown for docs/api/coverage.md (generated; do not edit by hand). */
export function coverageMarkdown(): string {
  const rows = UI_COVERAGE.map((c) => `| ${c.area} | ${c.operation} | ${c.operationIds.map((i) => `${endpoint(i)} (\`${i}\`)`).join('<br>')} | ${c.note ?? ''} |`);
  const only = API_ONLY.map((c) => `| ${c.operation} | ${c.operationIds.map((i) => `${endpoint(i)} (\`${i}\`)`).join('<br>')} |`);
  const na = NOT_APPLICABLE.map((c) => `| ${c.operation} | ${c.reason} |`);
  return [
    '<!-- GENERATED by `npm run api:spec` from server/api/coverage.ts. Do not edit by hand. -->',
    '# Coverage: UI operation to API endpoint',
    '',
    'Every operation available in the OpsDesk web UI, and the endpoint(s) that perform it. All paths are relative to `/api/v1`. A test fails if an endpoint listed here does not exist or if a documented endpoint is missing from this table.',
    '',
    '## UI operations',
    '',
    '| Area | UI operation | Endpoint(s) | Notes |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## API-only operations (no UI button)',
    '',
    '| Operation | Endpoint |',
    '| --- | --- |',
    ...only,
    '',
    '## Not applicable to the HTTP API',
    '',
    '| Browser/deployment behaviour | Why |',
    '| --- | --- |',
    ...na,
    '',
  ].join('\n');
}
