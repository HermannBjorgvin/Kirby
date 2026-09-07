import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Desktop-specific state: recently opened repositories. Lives in its
 * own file under ~/.kirby so the CLI's config.json schema (which has
 * migrations) is never touched by desktop concerns.
 */

export interface RecentRepo {
  cwd: string;
  lastOpenedAt: number;
}

const MAX_RECENTS = 10;

export function recentsFilePath(): string {
  return join(homedir(), '.kirby', 'desktop-recents.json');
}

export function loadRecents(file = recentsFilePath()): RecentRepo[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveRecents(
  recents: RecentRepo[],
  file = recentsFilePath()
): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(recents, null, 2) + '\n');
}

/** Record an open: move-to-front on dedupe, capped at MAX_RECENTS. */
export function recordOpen(
  recents: RecentRepo[],
  cwd: string,
  now = Date.now()
): RecentRepo[] {
  const next = [
    { cwd, lastOpenedAt: now },
    ...recents.filter((r) => r.cwd !== cwd),
  ].slice(0, MAX_RECENTS);
  return next;
}

export function forgetRecent(cwd: string, file = recentsFilePath()): void {
  if (!existsSync(file)) return;
  const next = loadRecents(file).filter((r) => r.cwd !== cwd);
  if (next.length === 0) {
    rmSync(file, { force: true });
    return;
  }
  saveRecents(next, file);
}

/**
 * Make sure a repository is on the list, without saying it was opened.
 *
 * A terminal tab restored at a repository root needs its repository on
 * the list — activating the tab opens that repository — but nobody
 * opened it just now, so it goes on the end and the order the user made
 * is left alone. Already listed means nothing to do.
 */
export function ensureRecent(
  cwd: string,
  file = recentsFilePath(),
  now = Date.now()
): void {
  const recents = loadRecents(file);
  if (recents.some((r) => r.cwd === cwd)) return;
  saveRecents(
    [...recents, { cwd, lastOpenedAt: now }].slice(0, MAX_RECENTS),
    file
  );
}
