import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
  pushBranch,
} from './setup/github.js';
import { sidebarLocator } from './setup/sidebar.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Two fresh branches. Both pushed + worktrees created, but NO PRs yet —
// PRs are created inside the test body to control timing and ensure
// deterministic cleanup.

const prefix = testBranchPrefix();
const branchA = `${prefix}/nav-a`;
const branchB = `${prefix}/nav-b`;
const sessionA = branchA.replace(/\//g, '-');
const sessionB = branchB.replace(/\//g, '-');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-navjump-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;

  execSync(
    `git clone "https://x-access-token:${token}@github.com/${TEST_REPO}.git" "${cloneDir}"`,
    { stdio: 'pipe' }
  );

  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
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
    `git worktree add "${join('.claude', 'worktrees', sessionA)}" "${branchA}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync(
    `git worktree add "${join('.claude', 'worktrees', sessionB)}" "${branchB}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
}

test.describe('@integration Navigation Jump', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: {
      aiCommand: 'cat',
      keybindPreset: 'vim',
      prPollInterval: 5000,
    },
    rows: 60,
    cols: 120,
  });

  test('selected session stays selected when another session moves to Pull Requests', async ({
    kirby,
  }) => {
    let prNumberA: number | undefined;

    try {
      // 1. Kirby rendered (fixture waited for it)
      await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

      // 2. Both sessions appear under "Worktrees" (no PRs yet).
      //    Order is [A, B] — sessions without PRs preserve input order.
      await expect(kirby.term.getByText(sessionA).first()).toBeVisible();
      await expect(kirby.term.getByText(sessionB).first()).toBeVisible();

      // 3. Navigate down once to select session B (index 1 within Worktrees)
      await kirby.term.write('j');
      await kirby.term.page.waitForTimeout(500);

      // 4. Session B is selected
      await expect(
        sidebarLocator(kirby.term.page, sessionB).selected()
      ).toBeVisible();

      // 5. Create a PR for branch A. A moves from Worktrees into
      //    Pull Requests, producing a reorder. Selection (tracked by
      //    stable key session:<name>) must stay on B.
      prNumberA = createPullRequest(TEST_REPO, branchA, cloneDir);

      // 6. Trigger PR refresh via 'r' periodically. Also polls via config
      //    (5s). Wait up to 90s for the search API to index the new PR.
      const refreshTimer = setInterval(() => {
        void kirby.term.write('r');
      }, 10_000);
      await kirby.term.write('r');

      try {
        await expect(kirby.term.getByText(`#${prNumberA}`).first()).toBeVisible(
          { timeout: 90_000 }
        );
      } finally {
        clearInterval(refreshTimer);
      }

      // Let React settle after the reorder.
      await kirby.term.page.waitForTimeout(1_000);

      // 7. Selection is still on session B
      await expect(
        sidebarLocator(kirby.term.page, sessionB).selected()
      ).toBeVisible();

      // 8. Selection is NOT on session A's PR row
      await expect(
        sidebarLocator(kirby.term.page, `e2e: ${branchA}`).selected()
      ).not.toBeVisible();
    } finally {
      // Cleanup GitHub resources (best-effort)
      if (prNumberA) closePullRequest(TEST_REPO, prNumberA);
      deleteRemoteBranch(TEST_REPO, branchA);
      deleteRemoteBranch(TEST_REPO, branchB);
    }
  });
});
