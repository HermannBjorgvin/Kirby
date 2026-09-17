import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/n10.js';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO, testBranchPrefix } from './setup/constants.js';
import {
  closePullRequest,
  createLocalBranch,
  createPullRequest,
  deleteRemoteBranch,
  pushBranch,
} from './setup/github.js';
import { sidebarLocator } from './setup/sidebar.js';
import { settleFor } from './setup/waits.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Two fresh branches. Both pushed + worktrees created, but NO PRs yet —
// PRs are created inside the test body to control timing and ensure
// deterministic cleanup.

const prefix = testBranchPrefix();
const branchA = `${prefix}/nav-a`;
const branchB = `${prefix}/nav-b`;
const worktreeDirA = branchA.replace(/\//g, '-');
const worktreeDirB = branchB.replace(/\//g, '-');

const cloneDir = mkdtempSync(join(tmpdir(), 'n10-navjump-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;

  execSync(
    `git clone "https://x-access-token:${token}@github.com/${TEST_REPO}.git" "${cloneDir}"`,
    { stdio: 'pipe' }
  );

  execSync('git config user.email "e2e@n10.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "n10 E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // Branch A + push
  createLocalBranch(cloneDir, branchA);
  pushBranch(cloneDir, branchA);

  // Back to default branch, then branch B + push
  const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
    cwd: cloneDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .trim()
    .replace('refs/remotes/origin/', '');
  execSync(`git checkout "${defaultBranch}"`, { cwd: cloneDir, stdio: 'pipe' });

  createLocalBranch(cloneDir, branchB);
  pushBranch(cloneDir, branchB);

  // Default branch again (worktree add requires the branch isn't checked out)
  execSync(`git checkout "${defaultBranch}"`, { cwd: cloneDir, stdio: 'pipe' });

  // Worktrees for both branches
  execSync(
    `git worktree add "${join(
      '.claude',
      'worktrees',
      worktreeDirA
    )}" "${branchA}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync(
    `git worktree add "${join(
      '.claude',
      'worktrees',
      worktreeDirB
    )}" "${branchB}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
}

/** Best-effort cleanup: the PR only exists if creation got that far. */
function closeIfOpened(prNumber: number | undefined): void {
  if (prNumber) closePullRequest(TEST_REPO, prNumber);
}

test.describe('@integration Navigation Jump', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    n10RepoPath: cloneDir,
    n10Config: {
      aiCommand: 'cat',
      keybindPreset: 'vim',
      prPollInterval: 5000,
    },
    rows: 60,
    cols: 120,
  });

  test('selected session stays selected when another session moves to Pull Requests', async ({
    n10,
  }) => {
    let prNumberA: number | undefined;

    try {
      // 1. n10 rendered (fixture waited for it)
      await expect(n10.term.getByText('n10').first()).toBeVisible();

      // 2. Both sessions appear under "Worktrees" (no PRs yet).
      //    Order is [A, B] — sessions without PRs preserve input order.
      await expect(sidebarLocator(n10.term.page, branchA).any()).toBeVisible();
      await expect(sidebarLocator(n10.term.page, branchB).any()).toBeVisible();

      // 3. Navigate down once to select session B (index 1 within Worktrees)
      await n10.term.write('j');
      await settleFor(
        n10.term.page,
        500,
        'the sidebar selection to move before the next key'
      );

      // 4. Session B is selected
      await expect(
        sidebarLocator(n10.term.page, branchB).selected()
      ).toBeVisible();

      // 5. Create a PR for branch A. A moves from Worktrees into
      //    Pull Requests, producing a reorder. Selection (tracked by
      //    stable key session:<name>) must stay on B.
      prNumberA = createPullRequest(TEST_REPO, branchA, cloneDir);

      // 6. Trigger PR refresh via 'r' periodically. Also polls via config
      //    (5s). Wait up to 90s for the search API to index the new PR.
      const refreshTimer = setInterval(() => {
        void n10.term.write('r');
      }, 10_000);
      await n10.term.write('r');

      try {
        await expect(n10.term.getByText(`#${prNumberA}`).first()).toBeVisible({
          timeout: 90_000,
        });
      } finally {
        clearInterval(refreshTimer);
      }

      // Let React settle after the reorder.
      await settleFor(
        n10.term.page,
        1_000,
        'the reorder to land, so the next assertion sees after it, not before'
      );

      // 7. Selection is still on session B
      await expect(
        sidebarLocator(n10.term.page, branchB).selected()
      ).toBeVisible();

      // 8. Selection is NOT on session A's PR row
      await expect(
        sidebarLocator(n10.term.page, `e2e: ${branchA}`).selected()
      ).toBeHidden();
    } finally {
      // Cleanup GitHub resources (best-effort)
      closeIfOpened(prNumberA);
      deleteRemoteBranch(TEST_REPO, branchA);
      deleteRemoteBranch(TEST_REPO, branchB);
    }
  });
});
