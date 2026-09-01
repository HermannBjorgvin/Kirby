import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

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
  /**
   * Directory name for the repo, inside a random parent.
   *
   * The repo's basename is on screen in three places (title bar,
   * sidebar header, status bar), so screenshot tests need it fixed —
   * otherwise every run differs by the tempdir's random suffix.
   */
  name?: string;
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
  const parent = mkdtempSync(join(tmpdir(), 'kirby-desktop-e2e-'));
  const dir = opts.name ? join(parent, opts.name) : parent;
  if (opts.name) mkdirSync(dir);
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

  for (const wt of opts.worktrees ?? []) addWorktree(dir, base, wt);
  return dir;
}

/**
 * Seed one worktree from its spec: the checkout, its files, an optional
 * conflicted rebase, and whatever HEAD state the test wants it left in.
 */
function addWorktree(dir: string, base: string, wt: TestRepoWorktree): void {
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
    // A seeded name may carry directories ('docs/guide.md'), which a
    // fresh checkout does not have.
    mkdirSync(dirname(join(path, name)), { recursive: true });
    writeFileSync(join(path, name), contents, 'utf8');
    git(path, ['add', name]);
  }
  if (Object.keys(wt.files ?? {}).length > 0) {
    git(path, ['commit', '-q', '-m', `seed ${wt.branch}`]);
  }

  if (wt.conflictedRebase) stopMidRebase(dir, path, wt.branch);

  if (wt.switchTo) git(path, ['checkout', '-q', '-b', wt.switchTo]);
  if (wt.detach) git(path, ['checkout', '-q', '--detach']);
  if (wt.deleteDirectory) rmSync(path, { recursive: true, force: true });
}

/**
 * Drive `branch` into a rebase that stops on a conflict, and prove it
 * actually stopped there.
 */
function stopMidRebase(dir: string, path: string, branch: string): void {
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
    throw new Error(`expected ${branch} to be mid-rebase, but it is not`);
  }
}

export function cleanupTestRepo(dir: string): void {
  // A named repo lives one level inside the tempdir we made, so remove
  // that parent rather than leaking it.
  const parent = dirname(dir);
  const target = basename(parent).startsWith('kirby-desktop-e2e-')
    ? parent
    : dir;
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
