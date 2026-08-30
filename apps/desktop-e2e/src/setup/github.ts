import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The shared sandbox repository the integration tests read from. It
 * holds permanent fixture pull requests (see CLAUDE.md); nothing here
 * modifies them.
 */
export const TEST_REPO =
  process.env.TEST_REPO ??
  'kirby-test-runner/kirby-integration-test-repository';

export const [TEST_REPO_OWNER, TEST_REPO_NAME] = TEST_REPO.split('/');

/**
 * Whether the integration tests can run.
 *
 * They talk to real GitHub. The desktop authenticates through the `gh`
 * CLI, but every test gets an isolated HOME, so `gh` inside the app
 * cannot reach the developer's stored credentials — the token has to be
 * handed to it explicitly, which is what GH_TOKEN is for.
 */
export function githubToken(): string | undefined {
  return process.env.GH_TOKEN || undefined;
}

/**
 * Clone the sandbox repo, with the fixture branches, into a tempdir the
 * caller owns. Read-only: nothing is pushed.
 */
export function cloneTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kirby-desktop-integration-'));
  execFileSync('git', ['clone', `https://github.com/${TEST_REPO}.git`, dir], {
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.email', 'e2e@kirby.dev'], {
    cwd: dir,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Kirby E2E'], {
    cwd: dir,
    stdio: 'pipe',
  });
  return dir;
}

export function removeClone(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
