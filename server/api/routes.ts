import { createReadStream, existsSync, statSync } from 'node:fs';
import { z } from 'zod';
import { ENVIRONMENTS, ENVIRONMENT_LABELS, LIMITS } from '../../shared/constants.js';
import { describeApiAccess, describeDatabase } from '../config.js';
import { backupPath, createBackup, createPreImportBackup, deleteBackup, listBackups, restoreBackup } from '../backup.js';
import { LATEST_SCHEMA_VERSION } from '../db/migrations.js';
import { AppError, notFound } from '../errors.js';
import { applyImport, buildExport, parseExportFile, previewImport, type ImportData } from '../importExport.js';
import { parseNetscapeBookmarks } from '../netscape.js';
import * as repo from '../repo.js';
import { completeSetup } from '../sample.js';
import * as v from '../validation.js';
import { readBuildInfo, VERSION } from '../version.js';
import { collectTags } from '../../shared/search.js';
import { etagOf } from './etag.js';
import { boolQ, envCsv, flatten, intQ, orderQuery, paginate, pageQuery, searchBookmarks, tagCsv } from './queries.js';
import type { Ctx, RouteDef } from './registry.js';
import { buildOpenApi } from './openapi.js';

/* ------------------------------------------------------------------ shared request schemas */

const id = (what: string) => z.string().min(1).max(64).meta({ description: `${what} identifier.`, example: '3f0c9d52-0000-4000-8000-000000000001' });
const idParams = (what: string) => z.object({ id: id(what) });

const deleteOptions = {
  mode: z.enum(['delete', 'move']).optional().meta({ description: 'Required when the target is not empty: "delete" removes the contents, "move" relocates them first.' }),
  targetId: z.string().min(1).max(64).optional().meta({ description: 'Destination (workspace id when deleting a workspace, group id when deleting a group) for mode "move".' }),
};
const deleteQuery = z.object(deleteOptions);
const deleteBody = z.object(deleteOptions);
const deleteOpts = (c: Ctx) => {
  const m = v.parse(deleteBody, { ...(c.query ?? {}), ...(c.body ?? {}) });
  return { mode: m.mode, targetId: m.targetId };
};

const importBody = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('json').meta({ description: 'An OpsDesk export document.' }),
    data: z.unknown().meta({ $ref: '#/components/schemas/ExportDocument' }),
    mode: z.enum(['merge', 'replace']).default('merge').meta({ description: 'merge adds to the dashboard; replace deletes everything first (needs confirmReplace on apply).' }),
    duplicates: z.enum(['skip', 'update']).default('skip').meta({ description: 'For bookmarks that already exist (same URL in the same group): keep them or update them from the file.' }),
    confirmReplace: z.boolean().optional().meta({ description: 'Destructive-action flag: must be true to apply a replace import.' }),
  }),
  z.object({
    source: z.literal('html').meta({ description: 'A browser bookmarks export (Netscape HTML). Merge only.' }),
    html: z.string().max(LIMITS.importBytes).meta({ description: 'The HTML file content (parsed as data, never rendered).' }),
    workspaceName: z.string().max(400).optional().meta({ description: 'Workspace to import into (default "Imported bookmarks"); created if missing.' }),
    duplicates: z.enum(['skip', 'update']).default('skip'),
  }),
]);

function resolveImport(raw: unknown) {
  const body = v.parse(importBody, raw);
  if (body.source === 'json') {
    return { data: parseExportFile(body.data), mode: body.mode, duplicates: body.duplicates, source: 'json' as const, warnings: [] as string[], confirmReplace: body.confirmReplace === true };
  }
  const name = v.parse(v.groupCreate, { name: body.workspaceName?.trim() || 'Imported bookmarks' }).name;
  const parsed = parseNetscapeBookmarks(body.html, name);
  if (parsed.workspaces.length === 0) {
    throw new AppError(400, 'nothing_to_import', `No importable http(s) bookmarks were found in this file.${parsed.warnings.length ? ' ' + parsed.warnings.join(' ') : ''}`);
  }
  return { data: { workspaces: parsed.workspaces } as ImportData, mode: 'merge' as const, duplicates: body.duplicates, source: 'html' as const, warnings: parsed.warnings, confirmReplace: false };
}

/** Multipart fields + file -> the JSON body shape. The file type is detected from its content. */
function fromMultipart(fields: Record<string, string>, file: { text: string; filename: string } | null): unknown {
  if (!file) throw new AppError(400, 'validation_error', 'Upload the export or bookmarks file in the "file" form field.', { file: 'A file is required.' });
  const looksJson = fields.source ? fields.source === 'json' : /^\s*\{/.test(file.text);
  const bool = (s: string | undefined) => (s === undefined ? undefined : s === 'true');
  if (looksJson) {
    let data: unknown;
    try {
      data = JSON.parse(file.text);
    } catch {
      throw new AppError(400, 'validation_error', 'The uploaded file is not valid JSON.', { file: 'Not valid JSON.' });
    }
    return { source: 'json', data, mode: fields.mode, duplicates: fields.duplicates, confirmReplace: bool(fields.confirmReplace) };
  }
  return { source: 'html', html: file.text, workspaceName: fields.workspaceName, duplicates: fields.duplicates };
}
const multipartSchema = {
  type: 'object',
  required: ['file'],
  properties: {
    file: { type: 'string', format: 'binary', description: `OpsDesk export (.json) or browser bookmarks (.html), max ${LIMITS.importBytes / 1024 / 1024} MB.` },
    mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' },
    duplicates: { type: 'string', enum: ['skip', 'update'], default: 'skip' },
    confirmReplace: { type: 'string', enum: ['true', 'false'], description: 'Must be "true" to apply a replace import.' },
    workspaceName: { type: 'string', description: 'HTML files only: target workspace.' },
    source: { type: 'string', enum: ['json', 'html'], description: 'Optional; detected from the content when omitted.' },
  },
};

const ref = (name: string) => name;
const created = (what: string, schema: string) => ({ status: 201, response: { description: `${what} created. The Location header points to it.`, schema: ref(schema), headers: { Location: { description: 'URL of the new resource.', schema: { type: 'string' } }, ETag: { description: 'Validator for If-Match.', schema: { type: 'string' } } } } });
const okOut = { status: 200, response: { description: 'Done.', schema: 'Ok' } };
const locate = (c: Ctx, path: string) => `${c.req.baseUrl}${path}`;

const route = (r: RouteDef): RouteDef => r;

/* ------------------------------------------------------------------------------- routes */

export const routes: RouteDef[] = [
  /* ---------- System ---------- */
  route({
    operationId: 'getHealth', method: 'get', path: '/health', tag: 'System', access: 'public', idempotency: 'safe',
    summary: 'Application health',
    description: 'Green/yellow/red health with database, storage and migration checks. HTTP 200 for green and yellow, **503** for red. The write probe runs in a rolled-back transaction: this GET never changes data. Bookmarked services are never probed.',
    success: { status: 200, response: { description: 'Healthy (green) or degraded (yellow).', schema: 'Health' } },
    errors: [503],
    handler: async (c) => {
      const { statusCode, body } = await c.health.run();
      return { status: statusCode, body };
    },
  }),
  route({
    operationId: 'getVersion', method: 'get', path: '/version', tag: 'System', access: 'public', idempotency: 'safe',
    summary: 'Application release version',
    description: 'The release version (from package.json, identical to the UI and /health) and genuine build metadata when the build recorded it.',
    success: { status: 200, response: { description: 'Version information.', schema: 'Version' } },
    handler: async () => ({ body: { application: 'opsdesk', version: VERSION, apiVersion: 'v1', build: readBuildInfo() } }),
  }),
  route({
    operationId: 'getCapabilities', method: 'get', path: '/capabilities', tag: 'System', access: 'public', idempotency: 'safe',
    summary: 'Capabilities, active database engine and limits',
    description: 'Read-only facts about this server: API version, active database engine (chosen at start-up, not changeable through the API), whether bearer-token access is enabled, supported features and limits. Contains no secrets and no filesystem paths.',
    success: { status: 200, response: { description: 'Capabilities.', schema: 'Capabilities' } },
    handler: async (c) => ({
      body: {
        apiVersion: 'v1', version: VERSION,
        engine: { client: c.app.engine, label: describeDatabase(c.app.config.database).label },
        authentication: { bearerToken: describeApiAccess(c.app.config).bearerToken, corsOrigins: describeApiAccess(c.app.config).corsOrigins },
        features: { fileBackups: c.app.engine === 'sqlite', multipartImport: true, idempotencyKey: true, conditionalRequests: true },
        limits: {
          pageSizeMax: 200, importBytes: LIMITS.importBytes, bookmarksTotal: LIMITS.bookmarksTotal, workspaces: LIMITS.workspaces,
          groupsPerWorkspace: LIMITS.groupsPerWorkspace, title: LIMITS.title, description: LIMITS.description, note: LIMITS.note,
        },
      },
    }),
  }),
  route({
    operationId: 'getOpenApiDocument', method: 'get', path: '/openapi.json', tag: 'System', access: 'public', idempotency: 'safe',
    summary: 'This API as an OpenAPI 3.1 document',
    description: 'The machine-readable contract, generated from the same route definitions and validation schemas the server executes.',
    success: { status: 200, response: { description: 'OpenAPI 3.1 document.', schema: { type: 'object' }, contentType: 'application/json' } },
    handler: async () => ({ body: buildOpenApi() }),
  }),
  route({
    operationId: 'getSession', method: 'get', path: '/session', tag: 'UI internals', access: 'read', idempotency: 'safe', internal: true,
    summary: 'Session information for the bundled UI',
    description: 'Used by the web UI (CSRF token, data locations). **Not an API credential**: the CSRF token only works together with a same-origin browser Origin header. CLI clients use a bearer token instead.',
    success: { status: 200, response: { description: 'Session information.', schema: 'Session' } },
    handler: async (c) => ({
      body: {
        csrfToken: c.app.csrfToken, version: VERSION, build: readBuildInfo(), dataDir: c.app.config.dataDir, dbPath: c.app.dbPath,
        backupDir: c.app.backupDir, schemaVersion: LATEST_SCHEMA_VERSION, database: describeDatabase(c.app.config.database),
        host: c.app.config.host, port: c.app.config.port,
      },
    }),
  }),

  /* ---------- Settings ---------- */
  route({
    operationId: 'getSettings', method: 'get', path: '/settings', tag: 'Settings', access: 'read', idempotency: 'safe',
    summary: 'Get application preferences',
    description: 'The only server-side, user-editable preference is the dashboard title. Theme, layout density and sidebar state are stored in the browser and are not part of the API. Database engine, credentials, ports and paths are deployment settings and cannot be read or changed here.',
    success: { status: 200, response: { description: 'Preferences.', schema: 'Settings' } },
    handler: async (c) => ({ body: { title: await repo.getTitle(c.db) } }),
  }),
  route({
    operationId: 'updateSettings', method: 'patch', path: '/settings', tag: 'Settings', access: 'write', idempotency: 'idempotent',
    summary: 'Change the dashboard title',
    body: v.settingsPatch, bodyRequired: true, bodyExamples: { title: { summary: 'Rename the dashboard', value: { title: 'Operations Desk' } } },
    success: { status: 200, response: { description: 'Updated preferences.', schema: 'Settings' } }, errors: [400],
    handler: async (c) => {
      await repo.setTitle(c.db, c.body.title);
      return { body: { title: await repo.getTitle(c.db) } };
    },
  }),
  route({
    operationId: 'completeSetup', method: 'post', path: '/setup', tag: 'Settings', access: 'write', idempotency: 'not-idempotent',
    summary: 'First-run choice: sample data or empty dashboard',
    description: 'Allowed once. A second call returns 409. Sample content is never inserted again after it was removed.',
    body: v.setupBody, bodyRequired: true, bodyExamples: { empty: { summary: 'Start empty', value: { choice: 'empty' } }, sample: { summary: 'Start with labelled sample data', value: { choice: 'sample' } } },
    success: okOut, errors: [400, 409],
    handler: async (c) => {
      if ((await repo.getSetupState(c.db)) === 'done') throw new AppError(409, 'conflict', 'Setup has already been completed.');
      await completeSetup(c.db, c.body.choice);
      return { body: { ok: true } };
    },
  }),
  route({
    operationId: 'removeSampleData', method: 'post', path: '/sample-data/remove', tag: 'Settings', access: 'write', idempotency: 'idempotent', destructive: true,
    summary: 'Remove untouched sample data',
    description: 'Deletes only sample items that were never edited or moved; anything the user created or changed is kept. Repeating the call removes nothing more.',
    success: { status: 200, response: { description: 'How many items were removed.', schema: 'SampleRemoval' } },
    handler: async (c) => ({ body: await repo.removeSampleData(c.db) }),
  }),

  /* ---------- Dashboard ---------- */
  route({
    operationId: 'getDashboard', method: 'get', path: '/dashboard', tag: 'Workspaces', access: 'read', idempotency: 'safe',
    summary: 'The whole dashboard tree',
    description: 'Title, setup state, all workspaces with their groups and bookmarks in display order, and recent ids. This is what the UI loads; prefer the paginated list endpoints for large dashboards.',
    success: { status: 200, response: { description: 'Dashboard.', schema: 'Dashboard' } },
    handler: async (c) => ({ body: await repo.getDashboard(c.db) }),
  }),

  /* ---------- Workspaces ---------- */
  route({
    operationId: 'listWorkspaces', method: 'get', path: '/workspaces', tag: 'Workspaces', access: 'read', idempotency: 'safe',
    summary: 'List workspaces (paginated)',
    query: z.object({
      q: z.string().max(100).optional().meta({ description: 'Case-insensitive substring of the name.' }),
      sort: z.enum(['position', 'name']).default('position'), order: orderQuery, ...pageQuery,
    }),
    success: { status: 200, response: { description: 'A page of workspace summaries.', schema: 'WorkspaceSummaryPage' } },
    handler: async (c) => {
      const d = await repo.getDashboard(c.db);
      let list = d.workspaces.map((w, i) => ({
        id: w.id, name: w.name, icon: w.icon, isSample: w.isSample, position: i,
        groupCount: w.groups.length, bookmarkCount: w.groups.reduce((n, g) => n + g.bookmarks.length, 0),
      }));
      if (c.query.q) list = list.filter((w) => w.name.toLowerCase().includes(String(c.query.q).toLowerCase()));
      if (c.query.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
      if (c.query.order === 'desc') list.reverse();
      return { body: paginate(list, c.query.limit, c.query.offset) };
    },
  }),
  route({
    operationId: 'createWorkspace', method: 'post', path: '/workspaces', tag: 'Workspaces', access: 'write', idempotency: 'not-idempotent', idempotencyKey: true,
    summary: 'Create a workspace',
    body: v.workspaceCreate, bodyRequired: true, bodyExamples: { minimal: { summary: 'Name only', value: { name: 'Observability' } }, withIcon: { summary: 'With a bundled icon', value: { name: 'Observability', icon: 'activity' } } },
    success: created('Workspace', 'Workspace'), errors: [400, 422],
    handler: async (c) => {
      if ((await repo.countAll(c.db)).workspaces >= LIMITS.workspaces) throw new AppError(400, 'limit_reached', `At most ${LIMITS.workspaces} workspaces.`);
      const w = await repo.createWorkspace(c.db, c.body);
      return { status: 201, body: w, headers: { Location: locate(c, `/workspaces/${w.id}`), ETag: etagOf('workspace', w) } };
    },
  }),
  route({
    operationId: 'getWorkspace', method: 'get', path: '/workspaces/{id}', tag: 'Workspaces', access: 'read', idempotency: 'safe', conditional: 'workspace',
    summary: 'Get a workspace with its groups and bookmarks',
    params: idParams('Workspace'), success: { status: 200, response: { description: 'The workspace. Carries an ETag.', schema: 'Workspace', headers: { ETag: { description: 'Validator for If-Match.', schema: { type: 'string' } } } } }, errors: [404],
    handler: async (c) => {
      const w = await repo.getWorkspace(c.db, c.params.id!);
      return { body: w, headers: { ETag: etagOf('workspace', w) } };
    },
  }),
  route({
    operationId: 'updateWorkspace', method: 'patch', path: '/workspaces/{id}', tag: 'Workspaces', access: 'write', idempotency: 'idempotent', conditional: 'workspace',
    summary: 'Edit a workspace (name, icon)',
    description: 'Send `If-Match: <ETag from GET>` to avoid overwriting a concurrent change (412 if it changed).',
    params: idParams('Workspace'), body: v.workspacePatch, bodyRequired: true, bodyExamples: { rename: { summary: 'Rename', value: { name: 'Observability & APM' } } },
    success: { status: 200, response: { description: 'Updated workspace.', schema: 'Workspace', headers: { ETag: { description: 'New validator.', schema: { type: 'string' } } } } }, errors: [400, 404, 412],
    handler: async (c) => {
      const w = await repo.updateWorkspace(c.db, c.params.id!, c.body);
      return { body: w, headers: { ETag: etagOf('workspace', w) } };
    },
  }),
  route({
    operationId: 'deleteWorkspace', method: 'delete', path: '/workspaces/{id}', tag: 'Workspaces', access: 'write', idempotency: 'idempotent', conditional: 'workspace', destructive: true,
    summary: 'Delete a workspace',
    description: '**Destructive.** An empty workspace is deleted directly. A workspace that contains groups needs an explicit `mode`: `delete` removes everything inside, `move` relocates its groups to `targetId` first. Without `mode` the call fails with 409 and changes nothing. Executed in one transaction. Repeating the call after success returns 404.',
    params: idParams('Workspace'), query: deleteQuery, body: deleteBody, bodyExamples: { move: { summary: 'Move groups elsewhere, then delete', value: { mode: 'move', targetId: '3f0c9d52-0000-4000-8000-000000000002' } }, remove: { summary: 'Delete with contents', value: { mode: 'delete' } } },
    success: okOut, errors: [400, 404, 409, 412],
    handler: async (c) => {
      await repo.deleteWorkspace(c.db, c.params.id!, deleteOpts(c));
      return { body: { ok: true } };
    },
  }),
  route({
    operationId: 'moveWorkspace', method: 'post', path: '/workspaces/{id}/move', tag: 'Workspaces', access: 'write', idempotency: 'idempotent', conditional: 'workspace',
    summary: 'Reorder a workspace',
    description: 'Places the workspace at zero-based `index` among all workspaces (values beyond the end mean "last"). Positions are renumbered in one transaction.',
    params: idParams('Workspace'), body: v.moveWorkspaceBody, bodyRequired: true, bodyExamples: { first: { summary: 'Move to the top', value: { index: 0 } } },
    success: okOut, errors: [400, 404, 412],
    handler: async (c) => {
      await repo.moveWorkspace(c.db, c.params.id!, c.body.index);
      return { body: { ok: true } };
    },
  }),

  /* ---------- Groups ---------- */
  route({
    operationId: 'listGroups', method: 'get', path: '/groups', tag: 'Groups', access: 'read', idempotency: 'safe',
    summary: 'List groups (paginated)',
    query: z.object({
      workspaceId: z.string().max(64).optional().meta({ description: 'Only groups of this workspace.' }),
      q: z.string().max(100).optional().meta({ description: 'Case-insensitive substring of the group name.' }),
      sort: z.enum(['position', 'name']).default('position'), order: orderQuery, ...pageQuery,
    }),
    success: { status: 200, response: { description: 'A page of group summaries (without bookmarks; use GET /groups/{id}).', schema: 'GroupSummaryPage' } },
    handler: async (c) => {
      const d = await repo.getDashboard(c.db);
      let list = d.workspaces.flatMap((w) => w.groups.map((g, i) => ({ id: g.id, workspaceId: w.id, name: g.name, collapsed: g.collapsed, isSample: g.isSample, position: i, bookmarkCount: g.bookmarks.length })));
      if (c.query.workspaceId) list = list.filter((g) => g.workspaceId === c.query.workspaceId);
      if (c.query.q) list = list.filter((g) => g.name.toLowerCase().includes(String(c.query.q).toLowerCase()));
      if (c.query.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
      if (c.query.order === 'desc') list.reverse();
      return { body: paginate(list, c.query.limit, c.query.offset) };
    },
  }),
  route({
    operationId: 'createGroup', method: 'post', path: '/workspaces/{id}/groups', tag: 'Groups', access: 'write', idempotency: 'not-idempotent', idempotencyKey: true,
    summary: 'Create a group in a workspace',
    params: idParams('Workspace'), body: v.groupCreate, bodyRequired: true, bodyExamples: { group: { summary: 'New group', value: { name: 'Elastic Stack' } } },
    success: created('Group', 'Group'), errors: [400, 404, 422],
    handler: async (c) => {
      const g = await repo.createGroup(c.db, c.params.id!, c.body);
      return { status: 201, body: g, headers: { Location: locate(c, `/groups/${g.id}`), ETag: etagOf('group', g) } };
    },
  }),
  route({
    operationId: 'getGroup', method: 'get', path: '/groups/{id}', tag: 'Groups', access: 'read', idempotency: 'safe', conditional: 'group',
    summary: 'Get a group with its bookmarks',
    params: idParams('Group'), success: { status: 200, response: { description: 'The group. Carries an ETag.', schema: 'Group', headers: { ETag: { description: 'Validator for If-Match.', schema: { type: 'string' } } } } }, errors: [404],
    handler: async (c) => {
      const g = await repo.getGroup(c.db, c.params.id!);
      return { body: g, headers: { ETag: etagOf('group', g) } };
    },
  }),
  route({
    operationId: 'updateGroup', method: 'patch', path: '/groups/{id}', tag: 'Groups', access: 'write', idempotency: 'idempotent', conditional: 'group',
    summary: 'Edit a group (name, collapsed)',
    params: idParams('Group'), body: v.groupPatch, bodyRequired: true, bodyExamples: { collapse: { summary: 'Collapse the group', value: { collapsed: true } } },
    success: { status: 200, response: { description: 'Updated group.', schema: 'Group', headers: { ETag: { description: 'New validator.', schema: { type: 'string' } } } } }, errors: [400, 404, 412],
    handler: async (c) => {
      const g = await repo.updateGroup(c.db, c.params.id!, c.body);
      return { body: g, headers: { ETag: etagOf('group', g) } };
    },
  }),
  route({
    operationId: 'deleteGroup', method: 'delete', path: '/groups/{id}', tag: 'Groups', access: 'write', idempotency: 'idempotent', conditional: 'group', destructive: true,
    summary: 'Delete a group',
    description: '**Destructive.** An empty group is deleted directly. A group that contains bookmarks needs an explicit `mode`: `delete` removes the bookmarks, `move` relocates them to the group `targetId` first. Without `mode` the call fails with 409 and changes nothing. One transaction.',
    params: idParams('Group'), query: deleteQuery, body: deleteBody, bodyExamples: { move: { summary: 'Move bookmarks to another group', value: { mode: 'move', targetId: '3f0c9d52-0000-4000-8000-000000000003' } } },
    success: okOut, errors: [400, 404, 409, 412],
    handler: async (c) => {
      await repo.deleteGroup(c.db, c.params.id!, deleteOpts(c));
      return { body: { ok: true } };
    },
  }),
  route({
    operationId: 'moveGroup', method: 'post', path: '/groups/{id}/move', tag: 'Groups', access: 'write', idempotency: 'idempotent', conditional: 'group',
    summary: 'Reorder a group or move it to another workspace',
    description: 'Places the group at `index`. Give `workspaceId` to move it to another workspace (appended at that index). One transaction.',
    params: idParams('Group'), body: v.moveGroupBody, bodyRequired: true, bodyExamples: { reorder: { summary: 'Move to the top of its workspace', value: { index: 0 } }, other: { summary: 'Move to another workspace', value: { workspaceId: '3f0c9d52-0000-4000-8000-000000000002', index: 0 } } },
    success: okOut, errors: [400, 404, 412],
    handler: async (c) => {
      await repo.moveGroup(c.db, c.params.id!, { workspaceId: c.body.workspaceId, index: c.body.index });
      return { body: { ok: true } };
    },
  }),

  /* ---------- Bookmarks ---------- */
  route({
    operationId: 'listBookmarks', method: 'get', path: '/bookmarks', tag: 'Bookmarks', access: 'read', idempotency: 'safe',
    summary: 'List and search bookmarks (paginated)',
    description: 'The same matching rules as the UI search: `q` is split on whitespace and every term must appear (case-insensitively) in title, description, URL, tags or owner. Omit `workspaceId` to search **all workspaces**; give it to search one. Filters combine with AND: environment matches ANY listed value, tag requires ALL listed tags, `favorite` filters pinned bookmarks. GET never changes state (it does not record an opening).',
    query: z.object({
      q: z.string().max(200).optional().meta({ description: 'Search terms.', example: 'kibana prod' }),
      workspaceId: z.string().max(64).optional().meta({ description: 'Restrict to one workspace (omit for all workspaces).' }),
      groupId: z.string().max(64).optional().meta({ description: 'Restrict to one group.' }),
      environment: envCsv.optional(), tag: tagCsv.optional(),
      favorite: boolQ.optional().meta({ type: 'boolean', description: '`true`: only pinned; `false`: only unpinned.' }),
      sort: z.enum(['position', 'title', 'createdAt', 'updatedAt', 'lastOpenedAt', 'openCount']).default('position').meta({ description: '`position` = display order (workspace, group, bookmark).' }),
      order: orderQuery, ...pageQuery,
    }),
    success: { status: 200, response: { description: 'A page of bookmarks with their location.', schema: 'BookmarkItemPage' } },
    handler: async (c) => {
      const d = await repo.getDashboard(c.db);
      return { body: paginate(searchBookmarks(d, c.query), c.query.limit, c.query.offset) };
    },
  }),
  route({
    operationId: 'createBookmark', method: 'post', path: '/groups/{id}/bookmarks', tag: 'Bookmarks', access: 'write', idempotency: 'not-idempotent', idempotencyKey: true,
    summary: 'Create a bookmark in a group',
    description: 'Only `http://` and `https://` URLs are accepted; embedded credentials are rejected. Pinning is the `favorite` field.',
    params: idParams('Group'), body: v.bookmarkCreate, bodyRequired: true,
    bodyExamples: {
      minimal: { summary: 'Title and URL', value: { title: 'Kibana', url: 'https://kibana.example.org:5601/app/discover' } },
      full: { summary: 'All fields', value: { title: 'Kibana', url: 'https://kibana.example.org:5601/app/discover', description: 'Log search', environment: 'production', owner: 'Observability', icon: 'search', tags: ['elastic', 'logs'], favorite: true, note: 'Start with the ops-logs-* data view.' } },
    },
    success: created('Bookmark', 'Bookmark'), errors: [400, 404, 422],
    handler: async (c) => {
      const b = await repo.createBookmark(c.db, c.params.id!, c.body);
      return { status: 201, body: b, headers: { Location: locate(c, `/bookmarks/${b.id}`), ETag: etagOf('bookmark', b) } };
    },
  }),
  route({
    operationId: 'getBookmark', method: 'get', path: '/bookmarks/{id}', tag: 'Bookmarks', access: 'read', idempotency: 'safe', conditional: 'bookmark',
    summary: 'Get a bookmark (including its URL)',
    description: 'Returns the bookmark data. It never opens the URL and never records an opening: use `recordBookmarkOpened` for that.',
    params: idParams('Bookmark'), success: { status: 200, response: { description: 'The bookmark. Carries an ETag.', schema: 'Bookmark', headers: { ETag: { description: 'Validator for If-Match.', schema: { type: 'string' } } } } }, errors: [404],
    handler: async (c) => {
      const b = await repo.getBookmark(c.db, c.params.id!);
      return { body: b, headers: { ETag: etagOf('bookmark', b) } };
    },
  }),
  route({
    operationId: 'updateBookmark', method: 'patch', path: '/bookmarks/{id}', tag: 'Bookmarks', access: 'write', idempotency: 'idempotent', conditional: 'bookmark',
    summary: 'Edit a bookmark (including pin/unpin)',
    description: 'Partial update: only the supplied fields change. `favorite` true/false pins or unpins. Use `If-Match` for lost-update protection. Moving between groups is a separate operation (`moveBookmark`).',
    params: idParams('Bookmark'), body: v.bookmarkPatch, bodyRequired: true,
    bodyExamples: { pin: { summary: 'Pin', value: { favorite: true } }, unpin: { summary: 'Unpin', value: { favorite: false } }, edit: { summary: 'Change title and tags', value: { title: 'Kibana (prod)', tags: ['elastic', 'prod'] } } },
    success: { status: 200, response: { description: 'Updated bookmark.', schema: 'Bookmark', headers: { ETag: { description: 'New validator.', schema: { type: 'string' } } } } }, errors: [400, 404, 412],
    handler: async (c) => {
      const b = await repo.updateBookmark(c.db, c.params.id!, c.body);
      return { body: b, headers: { ETag: etagOf('bookmark', b) } };
    },
  }),
  route({
    operationId: 'deleteBookmark', method: 'delete', path: '/bookmarks/{id}', tag: 'Bookmarks', access: 'write', idempotency: 'idempotent', conditional: 'bookmark', destructive: true,
    summary: 'Delete a bookmark',
    description: '**Destructive** (no confirmation parameter; use `If-Match` to make sure you delete what you saw). Repeating the call returns 404.',
    params: idParams('Bookmark'), success: okOut, errors: [404, 412],
    handler: async (c) => {
      await repo.deleteBookmark(c.db, c.params.id!);
      return { body: { ok: true } };
    },
  }),
  route({
    operationId: 'moveBookmark', method: 'post', path: '/bookmarks/{id}/move', tag: 'Bookmarks', access: 'write', idempotency: 'idempotent', conditional: 'bookmark',
    summary: 'Reorder a bookmark or move it to another group',
    description: 'Places the bookmark at zero-based `index` of `groupId` (the same group = reorder; another group, possibly in another workspace = move). Both lists are renumbered in one transaction.',
    params: idParams('Bookmark'), body: v.moveBookmarkBody, bodyRequired: true, bodyExamples: { move: { summary: 'Move to the top of a group', value: { groupId: '3f0c9d52-0000-4000-8000-000000000003', index: 0 } } },
    success: okOut, errors: [400, 404, 412],
    handler: async (c) => {
      await repo.moveBookmark(c.db, c.params.id!, { groupId: c.body.groupId, index: c.body.index });
      return { body: { ok: true } };
    },
  }),
  route({
    operationId: 'duplicateBookmark', method: 'post', path: '/bookmarks/{id}/duplicate', tag: 'Bookmarks', access: 'write', idempotency: 'not-idempotent', idempotencyKey: true,
    summary: 'Duplicate a bookmark',
    description: 'Creates a copy titled "<title> (copy)" right after the original, not pinned.',
    params: idParams('Bookmark'), success: created('Bookmark copy', 'Bookmark'), errors: [404, 422],
    handler: async (c) => {
      const b = await repo.duplicateBookmark(c.db, c.params.id!);
      return { status: 201, body: b, headers: { Location: locate(c, `/bookmarks/${b.id}`), ETag: etagOf('bookmark', b) } };
    },
  }),
  route({
    operationId: 'recordBookmarkOpened', method: 'post', path: '/bookmarks/{id}/opened', tag: 'Recent', access: 'write', idempotency: 'not-idempotent',
    summary: 'Record that a bookmark was opened',
    description: 'Updates the last-opened time and increments the open counter. This only records the event: the server never opens URLs or launches a browser. Each call counts as one opening.',
    params: idParams('Bookmark'), success: okOut, errors: [404],
    handler: async (c) => {
      await repo.markOpened(c.db, c.params.id!);
      return { body: { ok: true } };
    },
  }),

  /* ---------- Tags, environments, recent ---------- */
  route({
    operationId: 'listTags', method: 'get', path: '/tags', tag: 'Search and metadata', access: 'read', idempotency: 'safe',
    summary: 'List tags with usage counts (paginated)',
    description: 'Tags are free-form labels stored on bookmarks; there is no separate tag resource and no tag rename/merge in the application. To add, change or remove tags, edit the bookmark (`updateBookmark`).',
    query: z.object({ workspaceId: z.string().max(64).optional().meta({ description: 'Count within one workspace only.' }), q: z.string().max(32).optional().meta({ description: 'Substring filter.' }), ...pageQuery }),
    success: { status: 200, response: { description: 'A page of tags, most used first.', schema: 'TagPage' } },
    handler: async (c) => {
      const d = await repo.getDashboard(c.db);
      const ws = c.query.workspaceId ? d.workspaces.filter((w) => w.id === c.query.workspaceId) : d.workspaces;
      let tags = collectTags(ws);
      if (c.query.q) tags = tags.filter((t) => t.tag.toLowerCase().includes(String(c.query.q).toLowerCase()));
      return { body: paginate(tags, c.query.limit, c.query.offset) };
    },
  }),
  route({
    operationId: 'listEnvironments', method: 'get', path: '/environments', tag: 'Search and metadata', access: 'read', idempotency: 'safe',
    summary: 'List the supported environment values',
    description: 'The environment is a fixed enumeration (it cannot be extended through the API); each bookmark carries exactly one value.',
    success: { status: 200, response: { description: 'All environment values with usage counts.', schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { $ref: '#/components/schemas/EnvironmentInfo' } } } } } },
    handler: async (c) => {
      const counts = new Map<string, number>();
      for (const b of flatten(await repo.getDashboard(c.db))) counts.set(b.environment, (counts.get(b.environment) ?? 0) + 1);
      return { body: { items: ENVIRONMENTS.map((e) => ({ value: e, label: ENVIRONMENT_LABELS[e], bookmarkCount: counts.get(e) ?? 0 })) } };
    },
  }),
  route({
    operationId: 'listRecent', method: 'get', path: '/recent', tag: 'Recent', access: 'read', idempotency: 'safe',
    summary: 'Recently opened bookmarks',
    description: 'Bookmarks with a recorded opening, most recent first. Reading never records anything.',
    query: z.object({ limit: intQ(12, 1, 50).meta({ description: 'Maximum number of items (1-50).' }) }),
    success: { status: 200, response: { description: 'Recently opened bookmarks.', schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { $ref: '#/components/schemas/BookmarkItem' } } } } } },
    handler: async (c) => {
      const items = flatten(await repo.getDashboard(c.db)).filter((b) => b.lastOpenedAt !== null).sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt))).slice(0, c.query.limit);
      return { body: { items } };
    },
  }),
  route({
    operationId: 'clearRecent', method: 'delete', path: '/recent', tag: 'Recent', access: 'write', idempotency: 'idempotent', destructive: true,
    summary: 'Clear the recently-opened history',
    description: '**Destructive.** Resets last-opened time and open counters of all bookmarks. Bookmarks themselves are untouched. Repeating the call clears nothing more.',
    success: { status: 200, response: { description: 'Number of bookmarks reset.', schema: 'Cleared' } },
    handler: async (c) => ({ body: { cleared: await repo.clearRecent(c.db) } }),
  }),

  /* ---------- Import / export ---------- */
  route({
    operationId: 'exportDashboard', method: 'get', path: '/export', tag: 'Import and export', access: 'read', idempotency: 'safe',
    summary: 'Export the dashboard as a JSON file',
    description: 'Versioned portable document with all workspaces, groups, bookmarks and their order. Sent as an attachment (`Content-Disposition`). Excludes recently-opened history, sample markers and identifiers.',
    success: { status: 200, response: { description: 'The export document (file download).', schema: 'ExportDocument', contentType: 'application/json', headers: { 'Content-Disposition': { description: 'attachment; filename="opsdesk-export-<timestamp>.json"', schema: { type: 'string' } } } } },
    handler: async (c) => {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
      const text = JSON.stringify(await buildExport(c.db), null, 2);
      return { send: (res) => { res.setHeader('Content-Disposition', `attachment; filename="opsdesk-export-${stamp}.json"`); res.type('application/json').send(text); } };
    },
  }),
  route({
    operationId: 'previewImport', method: 'post', path: '/import/preview', tag: 'Import and export', access: 'write', idempotency: 'safe',
    summary: 'Preview an import without changing anything',
    description: 'Runs the real import inside a transaction that is always rolled back and reports exactly what would be added, updated, skipped or removed. **Does not modify data** (a POST only because the document is the request body). Accepts JSON or a multipart file upload (bearer clients).',
    body: importBody, bodyRequired: true, multipart: multipartSchema, fromMultipart,
    bodyExamples: {
      merge: { summary: 'Merge an export, keep existing duplicates', value: { source: 'json', mode: 'merge', duplicates: 'skip', data: { format: 'opsdesk-export', version: 1, workspaces: [{ name: 'Observability', groups: [{ name: 'Elastic Stack', bookmarks: [{ title: 'APM', url: 'https://apm.example.org/' }] }] }] } } },
      html: { summary: 'Browser bookmarks (HTML)', value: { source: 'html', workspaceName: 'Imported bookmarks', html: '<DL><DT><A HREF="https://wiki.example.org/">Wiki</A></DL>' } },
    },
    success: { status: 200, response: { description: 'What the import would do.', schema: 'ImportPreview' } }, errors: [400, 413, 415],
    handler: async (c) => {
      const r = resolveImport(c.body);
      return { body: await previewImport(c.db, r.data, { mode: r.mode, duplicates: r.duplicates, source: r.source, warnings: r.warnings }) };
    },
  }),
  route({
    operationId: 'applyImport', method: 'post', path: '/import/apply', tag: 'Import and export', access: 'write', idempotency: 'not-idempotent', idempotencyKey: true, destructive: true,
    summary: 'Apply an import (merge or replace)',
    description: 'A safety backup is created first (`backup` in the response), then the import runs as **one transaction**: any failure leaves existing data untouched.\n\n**Merge** (default) adds to the dashboard: workspaces/groups match by name (case-insensitive), bookmarks by normalised URL within the group; `duplicates` chooses skip or update.\n\n**Replace is destructive**: it deletes all current workspaces, groups and bookmarks first and requires `"confirmReplace": true`, otherwise the call fails with 400 `confirmation_required` and nothing changes. HTML imports are merge-only.',
    body: importBody, bodyRequired: true, multipart: multipartSchema, fromMultipart,
    bodyExamples: {
      merge: { summary: 'Merge', value: { source: 'json', mode: 'merge', duplicates: 'update', data: { format: 'opsdesk-export', version: 1, workspaces: [] } } },
      replace: { summary: 'Replace everything (destructive)', value: { source: 'json', mode: 'replace', confirmReplace: true, data: { format: 'opsdesk-export', version: 1, workspaces: [] } } },
    },
    success: { status: 200, response: { description: 'What was done and the name of the safety backup.', schema: 'ImportResult' } }, errors: [400, 413, 415, 422],
    handler: async (c) => {
      const r = resolveImport(c.body);
      if (r.mode === 'replace' && !r.confirmReplace) throw new AppError(400, 'confirmation_required', 'Replacing all data requires "confirmReplace": true.');
      const backup = await createPreImportBackup(c.app);
      const preview = await applyImport(c.db, r.data, { mode: r.mode, duplicates: r.duplicates, source: r.source, warnings: r.warnings }, c.importHooks);
      return { body: { preview, backup } };
    },
  }),

  /* ---------- Backups ---------- */
  route({
    operationId: 'listBackups', method: 'get', path: '/backups', tag: 'Backups', access: 'read', idempotency: 'safe',
    summary: 'List database backups (SQLite only)',
    description: 'Backup metadata (name, size, creation time, kind), newest first. Only available for SQLite; PostgreSQL/MySQL return 409 `not_supported` (use your database tools).',
    query: z.object({ kind: z.enum(['manual', 'auto', 'pre-import', 'pre-restore', 'other']).optional(), ...pageQuery }),
    success: { status: 200, response: { description: 'A page of backups.', schema: 'BackupInfoPage' } }, errors: [409],
    handler: async (c) => {
      let list = listBackups(c.app);
      if (c.query.kind) list = list.filter((b) => b.kind === c.query.kind);
      return { body: paginate(list, c.query.limit, c.query.offset) };
    },
  }),
  route({
    operationId: 'createBackup', method: 'post', path: '/backups', tag: 'Backups', access: 'write', idempotency: 'not-idempotent', idempotencyKey: true,
    summary: 'Create a manual backup (SQLite only)',
    description: 'Consistent snapshot while the application runs. The file stays in the server\'s backups folder; download it with `downloadBackup`.',
    success: created('Backup', 'BackupInfo'), errors: [409, 422],
    handler: async (c) => {
      const b = await createBackup(c.app, 'manual');
      return { status: 201, body: b, headers: { Location: locate(c, `/backups/${encodeURIComponent(b.name)}`) } };
    },
  }),
  route({
    operationId: 'getBackup', method: 'get', path: '/backups/{name}', tag: 'Backups', access: 'read', idempotency: 'safe',
    summary: 'Backup metadata',
    params: z.object({ name: z.string().max(128).meta({ example: 'manual-20261022T093000123Z.sqlite' }) }),
    success: { status: 200, response: { description: 'Backup metadata.', schema: 'BackupInfo' } }, errors: [400, 404, 409],
    handler: async (c) => {
      backupPath(c.app, c.params.name!);
      const b = listBackups(c.app).find((x) => x.name === c.params.name);
      if (!b) throw notFound('Backup');
      return { body: b };
    },
  }),
  route({
    operationId: 'downloadBackup', method: 'get', path: '/backups/{name}/download', tag: 'Backups', access: 'read', idempotency: 'safe',
    summary: 'Download a backup file',
    description: 'Streams the SQLite backup file (`application/vnd.sqlite3`) as an attachment. Only names inside the backups folder are accepted.',
    params: z.object({ name: z.string().max(128) }),
    success: { status: 200, response: { description: 'The SQLite file.', contentType: 'application/vnd.sqlite3', schema: { type: 'string', format: 'binary' }, headers: { 'Content-Disposition': { description: 'attachment; filename="<name>"', schema: { type: 'string' } } } } }, errors: [400, 404, 409],
    handler: async (c) => {
      const p = backupPath(c.app, c.params.name!);
      if (!existsSync(p)) throw notFound('Backup');
      return { send: (res) => { res.setHeader('Content-Disposition', `attachment; filename="${c.params.name}"`); res.setHeader('Content-Length', String(statSync(p).size)); res.type('application/vnd.sqlite3'); createReadStream(p).pipe(res); } };
    },
  }),
  route({
    operationId: 'restoreBackup', method: 'post', path: '/backups/{name}/restore', tag: 'Backups', access: 'write', idempotency: 'not-idempotent', destructive: true,
    summary: 'Restore a backup (SQLite only)',
    description: '**Destructive.** Replaces the current database with the backup after validating it (integrity check, schema version, tables) and saving the current data as a `pre-restore-*` backup. Requires `{"confirm": true}`; otherwise 400 `confirmation_required` and nothing changes. A failed restore puts the previous data back.',
    params: z.object({ name: z.string().max(128) }), body: z.object({ confirm: z.boolean().meta({ description: 'Must be true.' }) }), bodyRequired: true,
    bodyExamples: { confirm: { summary: 'Confirm', value: { confirm: true } } },
    success: { status: 200, response: { description: 'Restored. `safetyBackup` is the copy of the previous data.', schema: 'RestoreResult' } }, errors: [400, 404, 409],
    handler: async (c) => {
      if (c.body?.confirm !== true) throw new AppError(400, 'confirmation_required', 'Restoring requires {"confirm": true}.');
      return { body: await restoreBackup(c.app, c.params.name!) };
    },
  }),
  route({
    operationId: 'deleteBackup', method: 'delete', path: '/backups/{name}', tag: 'Backups', access: 'write', idempotency: 'idempotent', destructive: true,
    summary: 'Delete a backup file (SQLite only)',
    description: '**Destructive.** Removes the backup file. Repeating the call returns 404.',
    params: z.object({ name: z.string().max(128) }), success: okOut, errors: [400, 404, 409],
    handler: async (c) => {
      deleteBackup(c.app, c.params.name!);
      return { body: { ok: true } };
    },
  }),
];
