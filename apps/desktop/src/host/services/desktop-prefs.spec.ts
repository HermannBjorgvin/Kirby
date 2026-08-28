import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDesktopPrefs, saveDesktopPrefs } from './desktop-prefs.js';

/**
 * Desktop preferences are read by the *main* process before any window
 * exists — they decide the window chrome and the theme the native menu
 * shows. There is nowhere to surface an error at that point, so a file
 * that is missing, truncated or hand-edited into nonsense has to leave
 * the app starting with defaults rather than failing to open at all.
 */

let home: string;
let originalHome: string | undefined;

function prefsPath(): string {
  return join(home, '.kirby', 'desktop-prefs.json');
}

function writePrefs(contents: string): void {
  mkdirSync(join(home, '.kirby'), { recursive: true });
  writeFileSync(prefsPath(), contents, 'utf8');
}

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'kirby-prefs-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('loadDesktopPrefs', () => {
  it('falls back to defaults when nothing has been saved', () => {
    expect(loadDesktopPrefs()).toEqual({ theme: 'system', nativeFrame: false });
  });

  it('survives a corrupt file instead of failing to start', () => {
    // This is read before the first window; throwing here means no
    // window at all, with no way to tell the user why.
    writePrefs('{ not json at all');
    expect(loadDesktopPrefs()).toEqual({ theme: 'system', nativeFrame: false });
  });

  it('fills in keys a saved file does not have', () => {
    // Older installs, and anything added since, must not come back
    // undefined into the window chrome.
    writePrefs(JSON.stringify({ theme: 'dark' }));
    expect(loadDesktopPrefs()).toEqual({ theme: 'dark', nativeFrame: false });
  });

  it('reads a full file back', () => {
    writePrefs(JSON.stringify({ theme: 'light', nativeFrame: true }));
    expect(loadDesktopPrefs()).toEqual({ theme: 'light', nativeFrame: true });
  });
});

describe('saveDesktopPrefs', () => {
  it('creates the directory on a first-ever save', () => {
    const next = saveDesktopPrefs({ theme: 'dark' });
    expect(next).toEqual({ theme: 'dark', nativeFrame: false });
    expect(JSON.parse(readFileSync(prefsPath(), 'utf8'))).toEqual({
      theme: 'dark',
      nativeFrame: false,
    });
  });

  it('patches one key without dropping the others', () => {
    saveDesktopPrefs({ theme: 'dark', nativeFrame: true });
    const next = saveDesktopPrefs({ theme: 'light' });
    // Saving the theme from the menu must not reset the frame choice.
    expect(next).toEqual({ theme: 'light', nativeFrame: true });
  });

  it('returns the merged result the caller then broadcasts', () => {
    // main.ts feeds this straight into nativeTheme and the menu, so the
    // return value has to be complete, not just the patch.
    expect(saveDesktopPrefs({ nativeFrame: true })).toEqual({
      theme: 'system',
      nativeFrame: true,
    });
  });

  it('writes over a corrupt file rather than compounding it', () => {
    writePrefs('%%%');
    expect(saveDesktopPrefs({ theme: 'dark' })).toEqual({
      theme: 'dark',
      nativeFrame: false,
    });
    expect(loadDesktopPrefs().theme).toBe('dark');
  });
});
