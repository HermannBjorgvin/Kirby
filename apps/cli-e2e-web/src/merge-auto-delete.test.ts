import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO, testBranchPrefix } from './setup/constants.js';
import {
  closePullRequest,
  createLocalBranch,
  createPullRequest,
  deleteRemoteBranch,
  mergePullRequest,
  pushBranch,
} from './setup/github.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Only local/idempotent operations here. GitHub API calls (push,
// create PR, merge) move into the test body so retries don't create
// duplicate remote resources.

const prefix = testBranchPrefix();
const branchName = `${prefix}/test-merge`;
const sessionName = branchName.replace(/\//g, '-');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-integ-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;

  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}" -- --single-branch`, {
    stdio: 'pipe',
  });
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // Create local branch (no push — that happens in the test body)
  createLocalBranch(cloneDir, branchName);

  // Checkout default branch so `worktree add` can check out our branch
  const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
    cwd: cloneDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .trim()
    .replace('refs/remotes/origin/', '');
  execSync(`git checkout "${defaultBranch}"`, { cwd: cloneDir, stdio: 'pipe' });

  // Create worktree so Kirby sees it as an existing session on startup
  execSync(
    `git worktree add "${join(
      '.claude',
      'worktrees',
      sessionName
    )}" "${branchName}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
}

test.describe('@integration Merge Auto-Delete', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { autoDeleteOnMerge: true, keybindPreset: 'vim' },
    rows: 80,
  });

  test('detects merged PR and auto-deletes session', async ({ kirby }) => {
    // 1. Push branch + create PR (GitHub ops, not in module scope)
    pushBranch(cloneDir, branchName);
    const prNumber = createPullRequest(TEST_REPO, branchName, cloneDir);

    try {
      // 2. Kirby renders (fixture already waited) + session visible
      await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
      await expect(kirby.term.getByText(sessionName).first()).toBeVisible();

      // 3. Merge the PR now that we've confirmed the session is visible
      mergePullRequest(TEST_REPO, prNumber);

      // 4. Trigger sync periodically — GitHub search API may take 10-30s
      //    to index the merge. Press 'g' (sync shortcut) every 10s.
      const syncTimer = setInterval(() => {
        void kirby.term.type('g');
      }, 10_000);
      await kirby.term.type('g');

      try {
        // 5. Wait for the session row to disappear. In the unified sidebar,
        //    review PRs remain visible even after sessions are gone, so we
        //    assert the session name is gone rather than "(no sessions)".
        await expect(kirby.term.getByText(sessionName).first()).not.toBeVisible(
          { timeout: 90_000 }
        );
      } finally {
        clearInterval(syncTimer);
      }

      // 6. Worktree directory was removed
      const worktreePath = join(cloneDir, '.claude', 'worktrees', sessionName);
      expect(existsSync(worktreePath)).toBe(false);

      // 7. Local branch was deleted
      let branchExists = true;
      try {
        execSync(`git rev-parse --verify "${branchName}"`, {
          cwd: cloneDir,
          stdio: 'pipe',
        });
      } catch {
        branchExists = false;
      }
      expect(branchExists).toBe(false);

      // 8. Merge commit landed on local default branch (sync runs
      //    fetchRemote + fastForwardMainBranch)
      const defaultBranch = execSync(
        'git symbolic-ref refs/remotes/origin/HEAD',
        {
          cwd: cloneDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      )
        .trim()
        .replace('refs/remotes/origin/', '');

      const logOutput = execSync(
        `git log "${defaultBranch}" --oneline --grep="e2e test branch: ${branchName}"`,
        {
          cwd: cloneDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );
      expect(logOutput.trim()).not.toBe('');
    } finally {
      // Cleanup GitHub resources (best-effort)
      closePullRequest(TEST_REPO, prNumber);
      deleteRemoteBranch(TEST_REPO, branchName);
    }
  });
});
