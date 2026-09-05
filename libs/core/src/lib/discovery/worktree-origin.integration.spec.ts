import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { describeWorktreePath } from './worktree-origin.js';

/**
 * A worktree path back to its repository and branch, against real git:
 * the answer has to agree with what git says at the main checkout,
 * since that is what the tmux prefix and the desktop's repo identity
 * are computed from.
 */

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

let scratch: string;
let repo: string;
let worktree: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'kirby-origin-'));
  repo = join(scratch, 'repo');
  git(scratch, ['init', '-q', '-b', 'main', repo]);
  git(repo, ['config', 'user.email', 'test@kirby.dev']);
  git(repo, ['config', 'user.name', 'Kirby Test']);
  git(repo, ['commit', '-q', '--allow-empty', '-m', 'initial']);
  worktree = join(repo, '.claude', 'worktrees', 'feat-x');
  git(repo, ['worktree', 'add', '-q', '-b', 'feat/x', worktree]);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('describeWorktreePath', () => {
  it('names the main checkout and the branch of a linked worktree', () => {
    expect(describeWorktreePath(worktree)).toEqual({
      repoRoot: git(repo, ['rev-parse', '--show-toplevel']),
      branch: 'feat/x',
      detached: false,
    });
  });

  it('describes the main checkout as its own repository', () => {
    expect(describeWorktreePath(repo)).toEqual({
      repoRoot: git(repo, ['rev-parse', '--show-toplevel']),
      branch: 'main',
      detached: false,
    });
  });

  // The tmux prefix is a hash of the toplevel as git reports it, so a
  // path that reaches the worktree through a symlink must still answer
  // with the real root, or the session would be filed under a
  // repository that does not exist.
  it('answers with the real path when reached through a symlink', () => {
    const link = join(scratch, 'link');
    symlinkSync(repo, link);
    expect(
      describeWorktreePath(join(link, '.claude', 'worktrees', 'feat-x'))
    ).toEqual({
      repoRoot: realpathSync(repo),
      branch: 'feat/x',
      detached: false,
    });
  });

  it('falls back to the directory name on a detached HEAD', () => {
    const detached = join(repo, '.claude', 'worktrees', 'detached-here');
    git(repo, ['worktree', 'add', '-q', '--detach', detached]);
    expect(describeWorktreePath(detached)).toMatchObject({
      branch: basename(detached),
    });
  });

  it('is null for a directory that is gone or not a worktree', () => {
    expect(describeWorktreePath(join(scratch, 'nope'))).toBeNull();
    expect(describeWorktreePath(scratch)).toBeNull();
  });
});
