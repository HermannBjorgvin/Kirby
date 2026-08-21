import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoOpenStartDir, getRepo, isGitRepo, openRepo } from './repo.js';

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

describe('isGitRepo', () => {
  it('accepts a directory containing a .git directory', () => {
    expect(isGitRepo(gitDir)).toBe(true);
  });

  it('rejects a directory without .git', () => {
    expect(isGitRepo(plainDir)).toBe(false);
  });
});

describe('autoOpenStartDir', () => {
  afterEach(() => {
    // reset module state between tests by opening nothing
    try {
      openRepo(gitDir); // harmless re-open
    } catch {
      /* ignore */
    }
  });

  it('opens the repo when KIRBY_START_DIR is a valid git repo', () => {
    const info = autoOpenStartDir({ KIRBY_START_DIR: gitDir });
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
    expect(getRepo()?.cwd).toBe(gitDir);
  });

  it('leaves no active repo when the start dir is not a git repo', () => {
    const before = getRepo();
    const info = autoOpenStartDir({ KIRBY_START_DIR: plainDir });
    expect(info).toBeNull();
    // state unchanged (null stays null; a previously opened repo is
    // untouched — auto-open never closes anything)
    expect(getRepo()).toEqual(before);
  });

  it('does nothing when KIRBY_START_DIR is unset', () => {
    expect(autoOpenStartDir({})).toBeNull();
  });
});
