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

export interface TestRepoOptions {
  /** Extra branches to create off the initial commit. */
  branches?: string[];
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
  return dir;
}

/** Commit a file on `branch`, creating the branch if needed. */
export function commitOnBranch(
  repo: string,
  branch: string,
  file: string,
  contents: string
): void {
  const current = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const exists = git(repo, ['branch', '--list', branch]).trim().length > 0;
  git(
    repo,
    exists ? ['checkout', '-q', branch] : ['checkout', '-q', '-b', branch]
  );
  writeFileSync(join(repo, file), contents, 'utf8');
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', `edit ${file}`]);
  git(repo, ['checkout', '-q', current]);
}

export function cleanupTestRepo(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
