import type { Dialect } from './types.js';

export interface Migration {
  version: number;
  name: string;
  statements: Record<Dialect, string[]>;
}

const ENVS = `'production','preproduction','staging','development','lab','other'`;
const MYSQL_TAIL = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin';

/**
 * Append-only. Never edit a released migration; add a new one. Applied versions are recorded in the
 * `schema_migrations` table on every engine (SQLite databases created before that table existed are adopted
 * from PRAGMA user_version, see migrate.ts).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    statements: {
      sqlite: [
        `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
        `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, position INTEGER NOT NULL,
          is_sample INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
        `CREATE TABLE bookmark_groups (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL, position INTEGER NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, is_sample INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
        `CREATE INDEX idx_groups_workspace ON bookmark_groups(workspace_id, position)`,
        `CREATE TABLE bookmarks (id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES bookmark_groups(id) ON DELETE CASCADE,
          title TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          environment TEXT NOT NULL DEFAULT 'other' CHECK (environment IN (${ENVS})),
          owner TEXT NOT NULL DEFAULT '', icon TEXT, tags TEXT NOT NULL DEFAULT '[]', favorite INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL DEFAULT '', is_sample INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_opened_at TEXT, open_count INTEGER NOT NULL DEFAULT 0)`,
        `CREATE INDEX idx_bookmarks_group ON bookmarks(group_id, position)`,
        `CREATE INDEX idx_bookmarks_opened ON bookmarks(last_opened_at)`,
      ],
      postgres: [
        `CREATE TABLE IF NOT EXISTS meta ("key" VARCHAR(64) PRIMARY KEY, "value" TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS workspaces (id VARCHAR(64) PRIMARY KEY, name VARCHAR(255) NOT NULL, icon VARCHAR(64) NOT NULL,
          position INTEGER NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS bookmark_groups (id VARCHAR(64) PRIMARY KEY,
          workspace_id VARCHAR(64) NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL, position INTEGER NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, is_sample INTEGER NOT NULL DEFAULT 0,
          created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS idx_groups_workspace ON bookmark_groups(workspace_id, position)`,
        `CREATE TABLE IF NOT EXISTS bookmarks (id VARCHAR(64) PRIMARY KEY,
          group_id VARCHAR(64) NOT NULL REFERENCES bookmark_groups(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL,
          environment VARCHAR(32) NOT NULL DEFAULT 'other' CHECK (environment IN (${ENVS})),
          owner VARCHAR(255) NOT NULL DEFAULT '', icon VARCHAR(64), tags TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL,
          created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL, last_opened_at VARCHAR(40), open_count INTEGER NOT NULL DEFAULT 0)`,
        `CREATE INDEX IF NOT EXISTS idx_bookmarks_group ON bookmarks(group_id, position)`,
        `CREATE INDEX IF NOT EXISTS idx_bookmarks_opened ON bookmarks(last_opened_at)`,
      ],
      mysql: [
        `CREATE TABLE IF NOT EXISTS meta ("key" VARCHAR(64) NOT NULL PRIMARY KEY, "value" TEXT NOT NULL) ${MYSQL_TAIL}`,
        `CREATE TABLE IF NOT EXISTS workspaces (id VARCHAR(64) NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, icon VARCHAR(64) NOT NULL,
          position INT NOT NULL, is_sample INT NOT NULL DEFAULT 0, created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL) ${MYSQL_TAIL}`,
        `CREATE TABLE IF NOT EXISTS bookmark_groups (id VARCHAR(64) NOT NULL PRIMARY KEY, workspace_id VARCHAR(64) NOT NULL,
          name VARCHAR(255) NOT NULL, position INT NOT NULL, collapsed INT NOT NULL DEFAULT 0, is_sample INT NOT NULL DEFAULT 0,
          created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL,
          INDEX idx_groups_workspace (workspace_id, position),
          CONSTRAINT fk_groups_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE) ${MYSQL_TAIL}`,
        `CREATE TABLE IF NOT EXISTS bookmarks (id VARCHAR(64) NOT NULL PRIMARY KEY, group_id VARCHAR(64) NOT NULL,
          title VARCHAR(255) NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL,
          environment VARCHAR(32) NOT NULL DEFAULT 'other', owner VARCHAR(255) NOT NULL, icon VARCHAR(64), tags TEXT NOT NULL,
          favorite INT NOT NULL DEFAULT 0, note TEXT NOT NULL, is_sample INT NOT NULL DEFAULT 0, position INT NOT NULL,
          created_at VARCHAR(40) NOT NULL, updated_at VARCHAR(40) NOT NULL, last_opened_at VARCHAR(40), open_count INT NOT NULL DEFAULT 0,
          INDEX idx_bookmarks_group (group_id, position), INDEX idx_bookmarks_opened (last_opened_at),
          CONSTRAINT fk_bookmarks_group FOREIGN KEY (group_id) REFERENCES bookmark_groups(id) ON DELETE CASCADE,
          CONSTRAINT chk_bookmarks_env CHECK (environment IN (${ENVS}))) ${MYSQL_TAIL}`,
      ],
    },
  },
  {
    version: 2,
    name: 'health probe table',
    // Rows are only ever inserted inside a transaction that is rolled back; the table stays empty.
    statements: {
      sqlite: [`CREATE TABLE IF NOT EXISTS health_probe (id TEXT PRIMARY KEY, created_at TEXT NOT NULL)`],
      postgres: [`CREATE TABLE IF NOT EXISTS health_probe (id VARCHAR(64) PRIMARY KEY, created_at VARCHAR(40) NOT NULL)`],
      mysql: [`CREATE TABLE IF NOT EXISTS health_probe (id VARCHAR(64) NOT NULL PRIMARY KEY, created_at VARCHAR(40) NOT NULL) ${MYSQL_TAIL}`],
    },
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
