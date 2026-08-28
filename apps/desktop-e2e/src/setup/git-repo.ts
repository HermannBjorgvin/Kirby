import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Throwaway git repositories for the desktop e2e suite.
 *
 * The desktop app runs real git against whatever directory it opens,
 * so every test gets its own checkout rather than a mock. Repos are
 * seeded with a file and a commit: a bare `git init` has no tree, and
 * branch/diff features have nothing to show.
 */

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export interface TestRepoWorktree {
  branch: string;
  /** Files to write and commit inside the worktree, path → contents. */
  files?: Record<string, string>;
  /**
   * Leave the worktree on a detached HEAD, as `git worktree add --detach`
   * or a checkout of a SHA does. git then reports no branch for it.
   */
  detach?: boolean;
  /**
   * Check out a different branch *inside* the worktree — what happens
   * when an agent runs `git checkout -b` in its own workspace. The
   * directory name and the checked-out branch stop agreeing.
   */
  switchTo?: string;
  /**
   * Leave the worktree stopped in the middle of a conflicted rebase
   * onto the default branch, the state an agent lands in when its
   * rebase hits a conflict and it stops to ask.
   */
  conflictedRebase?: boolean;
  /** Delete the worktree directory, leaving git's registration behind. */
  deleteDirectory?: boolean;
}

export interface TestRepoOptions {
  /** Extra branches to create off the initial commit. */
  branches?: string[];
  /**
   * Worktrees to create before the app launches, in the same location
   * the app uses.
   *
   * Seeding a worktree's commits up front (rather than committing into
   * it mid-test) is what makes diff assertions deterministic: the
   * renderer caches a fetched diff for 60s, so a commit made after the
   * pane has already rendered would not show up inside a test's
   * lifetime.
   */
  worktrees?: TestRepoWorktree[];
}

export function createTestRepo(opts: TestRepoOptions = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'kirby-desktop-e2e-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@kirby.dev']);
  git(dir, ['config', 'user.name', 'Kirby Test']);
  // Commit hooks and signing would prompt or fail in CI.
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# test repo\n', 'utf8');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'initial']);

  for (const branch of opts.branches ?? []) {
    git(dir, ['branch', branch]);
  }

  const base = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const wt of opts.worktrees ?? []) {
    const path = join(dir, '.claude', 'worktrees', wt.branch);
    // A conflicted rebase needs the branch to diverge from main, so it
    // starts at the initial commit rather than at main's tip.
    git(dir, [
      'worktree',
      'add',
      '-q',
      path,
      '-b',
      wt.branch,
      ...(wt.conflictedRebase ? [base] : []),
    ]);

    for (const [name, contents] of Object.entries(wt.files ?? {})) {
      writeFileSync(join(path, name), contents, 'utf8');
      git(path, ['add', name]);
    }
    if (Object.keys(wt.files ?? {}).length > 0) {
      git(path, ['commit', '-q', '-m', `seed ${wt.branch}`]);
    }

    if (wt.conflictedRebase) {
      // Both sides edit the same line from a common ancestor, so
      // rebasing the branch onto main stops with a conflict.
      writeFileSync(join(path, 'CONFLICT.md'), 'branch version\n', 'utf8');
      git(path, ['add', 'CONFLICT.md']);
      git(path, ['commit', '-q', '-m', 'branch edit']);

      writeFileSync(join(dir, 'CONFLICT.md'), 'main version\n', 'utf8');
      git(dir, ['add', 'CONFLICT.md']);
      git(dir, ['commit', '-q', '-m', 'main edit']);

      try {
        git(path, ['rebase', 'main']);
      } catch {
        // Expected: a rebase that stops on a conflict exits non-zero.
      }
      // Assert we actually reached that state — a silently *successful*
      // rebase would leave the test asserting against a normal worktree
      // and passing for the wrong reason.
      const gitDir = git(path, ['rev-parse', '--absolute-git-dir']).trim();
      const midRebase =
        existsSync(join(gitDir, 'rebase-merge')) ||
        existsSync(join(gitDir, 'rebase-apply'));
      if (!midRebase) {
        throw new Error(
          `expected ${wt.branch} to be mid-rebase, but it is not`
        );
      }
    }

    if (wt.switchTo) git(path, ['checkout', '-q', '-b', wt.switchTo]);
    if (wt.detach) git(path, ['checkout', '-q', '--detach']);
    if (wt.deleteDirectory) rmSync(path, { recursive: true, force: true });
  }
  return dir;
}

export function cleanupTestRepo(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
