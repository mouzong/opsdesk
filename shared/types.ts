import type { Environment } from './constants.js';

export interface Bookmark {
  id: string;
  groupId: string;
  title: string;
  url: string;
  description: string;
  environment: Environment;
  owner: string;
  icon: string | null;
  tags: string[];
  favorite: boolean;
  note: string;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  /** How many times the bookmark was opened through the dashboard (or recorded via the API). */
  openCount: number;
}

export interface Group {
  id: string;
  workspaceId: string;
  name: string;
  collapsed: boolean;
  isSample: boolean;
  bookmarks: Bookmark[];
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  isSample: boolean;
  groups: Group[];
}

export type SetupState = 'pending' | 'done';

export interface Dashboard {
  title: string;
  setup: SetupState;
  workspaces: Workspace[];
  /** Bookmark ids, most recently opened first. */
  recent: string[];
}

export interface SessionInfo {
  csrfToken: string;
  /** The release version from package.json - the only version string in the product. */
  version: string;
  /** Real build metadata, present only for built (not dev-server) runs. */
  build: { builtAt: string; commit?: string } | null;
  dataDir: string;
  /** SQLite file path; empty for PostgreSQL/MySQL. */
  dbPath: string;
  backupDir: string;
  /** Read-only: chosen at start-up via OPSDESK_DB_CLIENT. Contains no credentials or host names. */
  database: { client: 'sqlite' | 'postgres' | 'mysql'; label: string; tls: boolean | null };
  schemaVersion: number;
  host: string;
  port: number;
}

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
  kind: 'manual' | 'auto' | 'pre-import' | 'pre-restore' | 'other';
}

/** Normalised import payload (JSON export format or parsed browser bookmarks). */
export interface ImportBookmark {
  title: string;
  url: string;
  description: string;
  environment: Environment;
  owner: string;
  icon: string | null;
  tags: string[];
  favorite: boolean;
  note: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}
export interface ImportGroup {
  name: string;
  collapsed: boolean;
  bookmarks: ImportBookmark[];
}
export interface ImportWorkspace {
  name: string;
  icon: string;
  groups: ImportGroup[];
}

export type ImportMode = 'merge' | 'replace';
export type DuplicatePolicy = 'skip' | 'update';

export interface ImportPreview {
  source: 'json' | 'html';
  mode: ImportMode;
  duplicates: DuplicatePolicy;
  counts: {
    workspacesAdded: number;
    workspacesExisting: number;
    groupsAdded: number;
    groupsExisting: number;
    bookmarksAdded: number;
    bookmarksUpdated: number;
    bookmarksSkipped: number;
    /** Replace mode only: what will be removed. */
    workspacesRemoved: number;
    groupsRemoved: number;
    bookmarksRemoved: number;
  };
  titleChange: { from: string; to: string } | null;
  warnings: string[];
  /** Short human-readable sample of what will change (max 25 lines). */
  sample: string[];
}

export interface ImportResult {
  preview: ImportPreview;
  backup: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
