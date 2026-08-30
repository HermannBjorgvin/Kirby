import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DesktopPrefs } from '../contract.js';

export type DesktopPrefsLike = DesktopPrefs;

/**
 * Desktop-only preferences that the main process needs *before* the
 * renderer exists (window chrome) or that the renderer must share with
 * the menu (theme). Kept in ~/.kirby/desktop-prefs.json, next to the
 * recents file; never merged into the CLI's config.
 */
const DEFAULTS: DesktopPrefs = {
  theme: 'system',
  nativeFrame: false,
};

function prefsPath(): string {
  return join(homedir(), '.kirby', 'desktop-prefs.json');
}

export function loadDesktopPrefs(): DesktopPrefs {
  try {
    const raw = JSON.parse(
      readFileSync(prefsPath(), 'utf8')
    ) as Partial<DesktopPrefs>;
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveDesktopPrefs(patch: Partial<DesktopPrefs>): DesktopPrefs {
  const next = { ...loadDesktopPrefs(), ...patch };
  const path = prefsPath();
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
