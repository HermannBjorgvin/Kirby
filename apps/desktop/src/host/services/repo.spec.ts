import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRepo, isGitRepo, openStartupRepo } from './repo.js';
import { loadRecents, saveRecents } from './recent-repos.js';
import type { RecentRepo } from '@kirby/vcs-core';

const recents = (cwds: string[]): RecentRepo[] =>
  cwds.map((cwd, i) => ({ cwd, lastOpenedAt: i }));

let gitDir: string;
let plainDir: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'kirby-repo-test-'));
  gitDir = join(base, 'repo');
  mkdirSync(join(gitDir, '.git'), { recursive: true });
  plainDir = join(base, 'plain');
  mkdirSync(plainDir, { recursive: true });
});

afterEach(() => {
  rmSync(join(gitDir, '..'), { recursive: true, force: true });
});

// openRepo records to the real recents store; snapshot and restore
// around the suite so tests never leave pollution behind.
let savedRecents: RecentRepo[] | null = null;
beforeAll(() => {
  savedRecents = loadRecents();
});
afterAll(() => {
  if (savedRecents) saveRecents(savedRecents);
});

describe('isGitRepo', () => {
  it('accepts a directory containing a .git directory', () => {
    expect(isGitRepo(gitDir)).toBe(true);
  });

  it('rejects a directory without .git', () => {
    expect(isGitRepo(plainDir)).toBe(false);
  });
});

describe('openStartupRepo', () => {
  it('opens the repo when KIRBY_START_DIR is a valid git repo', () => {
    const info = openStartupRepo({ KIRBY_START_DIR: gitDir });
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
    expect(getRepo()?.cwd).toBe(gitDir);
  });

  it('falls back to restoring the most recent valid repo', () => {
    // Launch without a start dir; recents injected explicitly.
    const info = openStartupRepo({}, recents([gitDir, '/gone/repo']));
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
  });

  it('skips dead recents when restoring', () => {
    const info = openStartupRepo(
      { KIRBY_START_DIR: plainDir },
      recents(['/gone/repo', gitDir])
    );
    // invalid start dir falls through to the first valid recent
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
  });

  it('returns null with no start dir and empty recents', () => {
    expect(openStartupRepo({ KIRBY_START_DIR: undefined }, [])).toBeNull();
  });
});
