export const APP_NAME = 'OpsDesk';
export const EXPORT_FORMAT = 'opsdesk-export';
export const EXPORT_VERSION = 1;

export const ENVIRONMENTS = ['production', 'preproduction', 'staging', 'development', 'lab', 'other'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const ENVIRONMENT_LABELS: Record<Environment, string> = {
  production: 'Production',
  preproduction: 'Preproduction',
  staging: 'Staging',
  development: 'Development',
  lab: 'Lab',
  other: 'Other',
};

/** Field limits, enforced by the server (authoritative) and mirrored in the forms. */
export const LIMITS = {
  dashboardTitle: 60,
  name: 80,
  title: 120,
  url: 2048,
  description: 500,
  note: 4000,
  owner: 80,
  tag: 32,
  tagsPerBookmark: 20,
  workspaces: 50,
  groupsPerWorkspace: 100,
  bookmarksTotal: 20000,
  importBytes: 5 * 1024 * 1024,
} as const;

/** Icons bundled with the app (rendered from the local lucide-react package). */
export const ICON_NAMES = [
  'globe', 'server', 'database', 'search', 'chart-line', 'chart-bar', 'activity', 'gauge', 'bell', 'siren',
  'shield', 'shield-alert', 'key-round', 'terminal', 'code', 'git-branch', 'git-merge', 'workflow', 'wrench', 'settings',
  'cloud', 'hard-drive', 'network', 'cpu', 'container', 'box', 'layers', 'package', 'rocket', 'zap',
  'book-open', 'file-text', 'scroll-text', 'clipboard-list', 'life-buoy', 'ticket', 'users', 'mail', 'calendar', 'bug',
  'flame', 'eye', 'radar', 'monitor', 'layout-dashboard', 'folder', 'bookmark', 'link', 'star', 'house',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export const DEFAULT_BOOKMARK_ICON: IconName = 'link';
export const DEFAULT_WORKSPACE_ICON: IconName = 'layout-dashboard';
