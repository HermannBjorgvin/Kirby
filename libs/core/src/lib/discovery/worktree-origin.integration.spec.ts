import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readWorktreeHead } from './worktree-origin.js';

/**
 * A worktree's branch, read from its own HEAD file against a real git
 * checkout: what tags a session at spawn time, what a listed session's
 * worktree is checked against, and what tells a detached HEAD apart.
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

/**
 * A linked worktree's `.git` is a file pointing at its git dir; the
 * main checkout's is the directory itself; both have to resolve, and
 * the branch has to be the exact string `git worktree list` reports.
 */
describe('readWorktreeHead', () => {
  it('reads the branch of a linked worktree', () => {
    expect(readWorktreeHead(worktree)).toEqual({
      branch: 'feat/x',
      detached: false,
    });
  });

  it('reads the branch of the main checkout', () => {
    expect(readWorktreeHead(repo)).toEqual({ branch: 'main', detached: false });
  });

  it('falls back to the directory name on a detached HEAD', () => {
    const detached = join(repo, '.claude', 'worktrees', 'detached-too');
    git(repo, ['worktree', 'add', '-q', '--detach', detached]);
    expect(readWorktreeHead(detached)).toEqual({
      branch: basename(detached),
      detached: true,
    });
  });

  it('agrees with git after the worktree checks out another branch', () => {
    const moved = join(repo, '.claude', 'worktrees', 'moved');
    git(repo, ['worktree', 'add', '-q', '-b', 'before/move', moved]);
    git(moved, ['checkout', '-q', '-b', 'after/move']);
    expect(readWorktreeHead(moved)).toEqual({
      branch: 'after/move',
      detached: false,
    });
    expect(git(moved, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(
      'after/move'
    );
  });

  it('is null for a directory that is gone or not a checkout', () => {
    expect(readWorktreeHead(join(scratch, 'nope'))).toBeNull();
    expect(readWorktreeHead(scratch)).toBeNull();
  });
});
