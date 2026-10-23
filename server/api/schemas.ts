import { z } from 'zod';
import { ENVIRONMENTS, ENVIRONMENT_LABELS, ICON_NAMES, LIMITS } from '../../shared/constants.js';

/** Every response model, registered with an id so OpenAPI refers to it as #/components/schemas/<id>. */
export const components = z.registry<{ id: string }>();
function reg<T extends z.ZodType>(id: string, schema: T): T {
  components.add(schema, { id });
  return schema;
}

const iso = z.string().meta({ format: 'date-time', example: '2026-10-22T09:30:00.000Z' });
const uuid = z.string().meta({ description: 'Opaque stable identifier (UUID).', example: '3f0c9d52-0000-4000-8000-000000000001' });
export const Environment = z.enum(ENVIRONMENTS);

export const Bookmark = reg('Bookmark', z.object({
  id: uuid, groupId: uuid,
  title: z.string().max(LIMITS.title), url: z.string().meta({ format: 'uri' }), description: z.string().max(LIMITS.description),
  environment: Environment, owner: z.string().max(LIMITS.owner), icon: z.enum(ICON_NAMES).nullable(),
  tags: z.array(z.string()).max(LIMITS.tagsPerBookmark), favorite: z.boolean().meta({ description: 'Pinned. "Pin" and "favorite" are the same field.' }),
  note: z.string().max(LIMITS.note), isSample: z.boolean(),
  createdAt: iso, updatedAt: iso, lastOpenedAt: iso.nullable(), openCount: z.number().int().min(0),
}));
export const BookmarkItem = reg('BookmarkItem', Bookmark.extend({ workspaceId: uuid, workspaceName: z.string(), groupName: z.string() }));
export const Group = reg('Group', z.object({
  id: uuid, workspaceId: uuid, name: z.string(), collapsed: z.boolean(), isSample: z.boolean(), bookmarks: z.array(Bookmark),
}));
export const GroupSummary = reg('GroupSummary', z.object({
  id: uuid, workspaceId: uuid, name: z.string(), collapsed: z.boolean(), isSample: z.boolean(), position: z.number().int().min(0), bookmarkCount: z.number().int().min(0),
}));
export const Workspace = reg('Workspace', z.object({ id: uuid, name: z.string(), icon: z.string(), isSample: z.boolean(), groups: z.array(Group) }));
export const WorkspaceSummary = reg('WorkspaceSummary', z.object({
  id: uuid, name: z.string(), icon: z.string(), isSample: z.boolean(), position: z.number().int().min(0), groupCount: z.number().int().min(0), bookmarkCount: z.number().int().min(0),
}));
export const Dashboard = reg('Dashboard', z.object({
  title: z.string(), setup: z.enum(['pending', 'done']), workspaces: z.array(Workspace), recent: z.array(uuid).meta({ description: 'Most recently opened bookmark ids (max 12).' }),
}));
export const Settings = reg('Settings', z.object({ title: z.string().max(LIMITS.dashboardTitle) }));
export const Ok = reg('Ok', z.object({ ok: z.literal(true) }));
export const Cleared = reg('Cleared', z.object({ cleared: z.number().int().min(0).meta({ description: 'Bookmarks whose history was reset.' }) }));
export const SampleRemoval = reg('SampleRemoval', z.object({ bookmarks: z.number().int(), groups: z.number().int(), workspaces: z.number().int() }));
export const Tag = reg('Tag', z.object({ tag: z.string(), count: z.number().int().min(1) }));
export const EnvironmentInfo = reg('EnvironmentInfo', z.object({ value: Environment, label: z.string(), bookmarkCount: z.number().int().min(0) }));

export const PageInfo = reg('PageInfo', z.object({
  limit: z.number().int(), offset: z.number().int(), total: z.number().int().min(0), hasMore: z.boolean(),
}));
const pageOf = <T extends z.ZodType>(id: string, item: T) => reg(id, z.object({ items: z.array(item), page: PageInfo }));
export const WorkspaceSummaryPage = pageOf('WorkspaceSummaryPage', WorkspaceSummary);
export const GroupSummaryPage = pageOf('GroupSummaryPage', GroupSummary);
export const BookmarkItemPage = pageOf('BookmarkItemPage', BookmarkItem);
export const TagPage = pageOf('TagPage', Tag);

export const ApiError = reg('ApiError', z.object({
  error: z.object({
    code: z.string().meta({ description: 'Stable machine-readable code (see "Errors and status codes").', example: 'validation_error' }),
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional().meta({ description: 'Field-level messages for validation errors, keyed by field path.' }),
    requestId: z.string().meta({ description: 'Same value as the X-Request-Id response header.' }),
  }),
}));

export const Version = reg('Version', z.object({
  application: z.literal('opsdesk'), version: z.string().meta({ example: '1.3.0' }), apiVersion: z.literal('v1'),
  build: z.object({ builtAt: iso, commit: z.string().optional() }).nullable(),
}));
export const Capabilities = reg('Capabilities', z.object({
  apiVersion: z.literal('v1'), version: z.string(),
  engine: z.object({ client: z.enum(['sqlite', 'postgres', 'mysql']), label: z.string() }).meta({ description: 'Read-only: chosen at server start-up.' }),
  authentication: z.object({
    bearerToken: z.boolean().meta({ description: 'true when OPSDESK_API_TOKEN is configured, so the API accepts Authorization: Bearer.' }),
    corsOrigins: z.number().int().meta({ description: 'Number of explicitly allowed browser origins (names are not disclosed).' }),
  }),
  features: z.object({
    fileBackups: z.boolean().meta({ description: 'SQLite database-file backups (false on PostgreSQL/MySQL).' }),
    multipartImport: z.boolean(), idempotencyKey: z.boolean(), conditionalRequests: z.boolean(),
  }),
  limits: z.object({
    pageSizeMax: z.number().int(), importBytes: z.number().int(), bookmarksTotal: z.number().int(), workspaces: z.number().int(),
    groupsPerWorkspace: z.number().int(), title: z.number().int(), description: z.number().int(), note: z.number().int(),
  }),
}));

const check = z.object({ status: z.enum(['green', 'yellow', 'red', 'not_applicable']), error: z.string().optional() });
export const Health = reg('Health', z.object({
  application_name: z.literal('opsdesk'), status: z.enum(['green', 'yellow', 'red']), timed_out: z.boolean(), version: z.string(),
  timestamp: z.string(), uptime_in_seconds: z.number().int(), cached: z.boolean(),
  checks: z.object({
    database: check.extend({ type: z.string(), readable: z.boolean(), writable: z.boolean(), response_time_ms: z.number() }),
    storage: check.extend({ data_directory_writable: z.union([z.boolean(), z.literal('not_applicable')]), backup_directory_writable: z.boolean() }),
    migrations: check.extend({ current_version: z.string().nullable(), latest_version: z.string(), pending: z.number().int().nullable() }),
  }),
  response_time_ms: z.number(),
}));
export const Session = reg('Session', z.object({
  csrfToken: z.string().meta({ description: 'UI-internal CSRF token. NOT an API credential.' }), version: z.string(),
  build: z.object({ builtAt: iso, commit: z.string().optional() }).nullable(),
  dataDir: z.string(), dbPath: z.string(), backupDir: z.string(), schemaVersion: z.number().int(),
  database: z.object({ client: z.enum(['sqlite', 'postgres', 'mysql']), label: z.string(), tls: z.boolean().nullable() }), host: z.string(), port: z.number().int(),
}));

const exportBookmark = z.object({
  title: z.string(), url: z.string(), description: z.string(), environment: Environment, owner: z.string(), icon: z.string().nullable(),
  tags: z.array(z.string()), favorite: z.boolean(), note: z.string(), createdAt: iso, updatedAt: iso,
});
export const ExportDocument = reg('ExportDocument', z.object({
  format: z.literal('opsdesk-export'), version: z.number().int().meta({ example: 1 }), exportedAt: iso, app: z.literal('OpsDesk'),
  dashboard: z.object({ title: z.string() }),
  workspaces: z.array(z.object({
    name: z.string(), icon: z.string(),
    groups: z.array(z.object({ name: z.string(), collapsed: z.boolean(), bookmarks: z.array(exportBookmark) })),
  })),
}));

export const ImportPreview = reg('ImportPreview', z.object({
  source: z.enum(['json', 'html']), mode: z.enum(['merge', 'replace']), duplicates: z.enum(['skip', 'update']),
  counts: z.object({
    workspacesAdded: z.number().int(), workspacesExisting: z.number().int(), groupsAdded: z.number().int(), groupsExisting: z.number().int(),
    bookmarksAdded: z.number().int(), bookmarksUpdated: z.number().int(), bookmarksSkipped: z.number().int(),
    workspacesRemoved: z.number().int(), groupsRemoved: z.number().int(), bookmarksRemoved: z.number().int(),
  }),
  titleChange: z.object({ from: z.string(), to: z.string() }).nullable(), warnings: z.array(z.string()), sample: z.array(z.string()).max(25),
}));
export const ImportResult = reg('ImportResult', z.object({
  preview: ImportPreview, backup: z.string().meta({ description: 'Name of the safety backup created before the import (SQLite: pre-import-*.sqlite, PostgreSQL/MySQL: pre-import-*.json).' }),
}));
export const BackupInfo = reg('BackupInfo', z.object({
  name: z.string(), sizeBytes: z.number().int(), createdAt: iso, kind: z.enum(['manual', 'auto', 'pre-import', 'pre-restore', 'other']),
}));
export const BackupInfoPage = pageOf('BackupInfoPage', BackupInfo);
export const RestoreResult = reg('RestoreResult', z.object({ safetyBackup: z.string() }));

export const EnvironmentLabels = ENVIRONMENT_LABELS;
