import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  activeRepoIs,
  forgetRecentRepo,
  getRepo,
  isGitRepo,
  listRecentRepos,
  openRepo,
  openStartupRepo,
} from './repo.js';
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

describe('isGitRepo (worktrees and submodules)', () => {
  it('accepts a checkout whose .git is a file', () => {
    // git worktrees and submodules point at the real git dir with a
    // file, not a directory; rejecting those would hide every worktree
    // from the picker.
    const base = mkdtempSync(join(tmpdir(), 'kirby-repo-file-'));
    const wt = join(base, 'wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    try {
      expect(isGitRepo(wt)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a directory that does not exist', () => {
    expect(isGitRepo(join(tmpdir(), 'kirby-definitely-not-here'))).toBe(false);
  });
});

describe('opening a repository', () => {
  it('refuses a directory that is not a repository', () => {
    // The picker relies on this to keep the user on the picker with an
    // error, rather than opening an empty workspace over nothing.
    expect(() => openRepo(plainDir)).toThrow(/Not a git repository/);
  });

  it('leaves the active repo alone when the open fails', () => {
    openRepo(gitDir);
    expect(getRepo()?.cwd).toBe(gitDir);

    expect(() => openRepo(plainDir)).toThrow();
    // A failed switch must not strand the app between two repos.
    expect(getRepo()?.cwd).toBe(gitDir);
    expect(activeRepoIs(gitDir)).toBe(true);
  });

  it('tracks which repo long-running work belongs to', () => {
    openRepo(gitDir);
    expect(activeRepoIs(gitDir)).toBe(true);
    expect(activeRepoIs(plainDir)).toBe(false);
  });
});

describe('recent repositories', () => {
  it('records an opened repo, newest first', () => {
    saveRecents([]);
    openRepo(gitDir);
    expect(listRecentRepos()[0].cwd).toBe(gitDir);
  });

  it('marks a recent that no longer exists as invalid rather than dropping it', () => {
    // The picker greys these out, which tells the user what happened;
    // silently removing them looks like Kirby lost their repo.
    const dead = join(tmpdir(), 'kirby-gone-forever');
    saveRecents(recents([gitDir, dead]));
    const listed = listRecentRepos();
    expect(listed.map((r) => r.cwd)).toContain(dead);
    expect(listed.find((r) => r.cwd === dead)?.valid).toBe(false);
    expect(listed.find((r) => r.cwd === gitDir)?.valid).toBe(true);
  });

  it('forgets a repo on request', () => {
    saveRecents(recents([gitDir, plainDir]));
    forgetRecentRepo(plainDir);
    expect(listRecentRepos().map((r) => r.cwd)).toEqual([gitDir]);
  });

  it('caps the list so it stays a menu rather than a history', () => {
    saveRecents(recents(Array.from({ length: 25 }, (_, i) => `/repo-${i}`)));
    expect(listRecentRepos().length).toBeLessThanOrEqual(10);
  });
});
