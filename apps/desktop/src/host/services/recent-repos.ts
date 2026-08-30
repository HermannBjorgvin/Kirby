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
