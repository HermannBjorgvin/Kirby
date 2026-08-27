import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  for (const wt of opts.worktrees ?? []) {
    const path = join(dir, '.claude', 'worktrees', wt.branch);
    git(dir, ['worktree', 'add', '-q', path, '-b', wt.branch]);
    const files = Object.entries(wt.files ?? {});
    if (files.length === 0) continue;
    for (const [name, contents] of files) {
      writeFileSync(join(path, name), contents, 'utf8');
      git(path, ['add', name]);
    }
    git(path, ['commit', '-q', '-m', `seed ${wt.branch}`]);
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
