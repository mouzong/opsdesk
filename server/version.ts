import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Reads the version from package.json (single source of truth), walking up from this file. */
function readVersion(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'opsdesk' && pkg.version) return pkg.version;
    } catch {
      /* keep walking */
    }
    dir = dirname(dir);
  }
  return 'unknown';
}

export const VERSION = readVersion();

export interface BuildInfo {
  /** ISO-8601 time at which `npm run build` ran. */
  builtAt: string;
  /** Short commit id, only when the build ran inside a git checkout or OPSDESK_COMMIT was provided. */
  commit?: string;
}

/**
 * Genuine build metadata written by scripts/build-info.mjs at the end of `npm run build`.
 * Returned only when it belongs to the version currently in package.json - a stale file from an
 * older build is ignored rather than shown, and nothing is ever invented.
 */
export function readBuildInfo(dir: string = import.meta.dirname, version: string = VERSION): BuildInfo | null {
  for (const file of [join(dir, '..', 'build-info.json'), join(dir, '..', 'dist', 'build-info.json')]) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown; builtAt?: unknown; commit?: unknown };
      if (raw.version !== version || typeof raw.builtAt !== 'string' || Number.isNaN(Date.parse(raw.builtAt))) continue;
      const commit = typeof raw.commit === 'string' && /^[0-9a-f]{7,40}$/i.test(raw.commit) ? raw.commit : undefined;
      return { builtAt: raw.builtAt, ...(commit ? { commit } : {}) };
    } catch {
      /* try next location */
    }
  }
  return null;
}
