import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO, testBranchPrefix } from './setup/constants.js';
import {
  createLocalBranch,
  pushBranch,
  createPullRequest,
  closePullRequest,
  deleteRemoteBranch,
} from './setup/github.js';
import { sidebarLocator } from './setup/sidebar.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Two fresh branches. Both pushed to remote, worktrees created, but NO PRs yet.
// PRs are created inside the test body to control timing and ensure cleanup.

const prefix = testBranchPrefix();
const branchA = `${prefix}/nav-a`;
const branchB = `${prefix}/nav-b`;
const sessionA = branchA.replace(/\//g, '-');
const sessionB = branchB.replace(/\//g, '-');
const mainJs = resolve('../cli/dist/main.js');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-navjump-clone-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'kirby-navjump-home-'));
const logFile = join(tmpdir(), 'kirby-navjump-debug.log');
registerCleanup(cloneDir);
registerCleanup(fakeHome);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;

  // 1. Clone test repo
  execSync(
    `git clone "https://x-access-token:${token}@github.com/${TEST_REPO}.git" "${cloneDir}"`,
    { stdio: 'pipe' }
  );

  // 2. Configure git identity
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 3. Create branch A + push
  createLocalBranch(cloneDir, branchA);
  pushBranch(cloneDir, branchA);

  // 4. Go back to default branch, then create branch B + push
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

  // 5. Back to default branch (worktree add requires branch not checked out)
  execSync(`git checkout "${defaultBranch}"`, { cwd: cloneDir, stdio: 'pipe' });

  // 6. Create worktrees for both branches
  execSync(
    `git worktree add "${join('.claude', 'worktrees', sessionA)}" "${branchA}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync(
    `git worktree add "${join('.claude', 'worktrees', sessionB)}" "${branchB}"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );

  // 7. Write Kirby config with short PR poll interval (5s) for faster refresh
  const kirbyDir = join(fakeHome, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(
    join(kirbyDir, 'config.json'),
    JSON.stringify({
      aiCommand: 'cat',
      keybindPreset: 'vim',
      prPollInterval: 5000,
    }),
    'utf-8'
  );
}

// ── Configure tui-test ─────────────────────────────────────────────
test.use({
  rows: 60,
  columns: 120,
  program: {
    file: 'node',
    args: [mainJs, cloneDir],
  },
  env: {
    ...process.env,
    HOME: fakeHome,
    TERM: 'xterm-256color',
    KIRBY_LOG: logFile,
  },
});

// ── Tests ──────────────────────────────────────────────────────────

test.when(
  hasGhToken,
  'selected session stays selected after PR data refresh reorders items',
  async ({ terminal }) => {
    let prNumberA: number | undefined;
    let prNumberB: number | undefined;

    try {
      // 1. Wait for Kirby to render
      await expect(
        terminal.getByText('Kirby', { strict: false })
      ).toBeVisible();

      // 2. Both sessions should appear (no PRs yet — both show session names)
      await expect(
        terminal.getByText(sessionA, { strict: false })
      ).toBeVisible();
      await expect(
        terminal.getByText(sessionB, { strict: false })
      ).toBeVisible();

      // 3. Create PR for branch A. This PR will be indexed by GitHub Search
      //    within ~30-90 seconds. We need it to appear before proceeding.
      prNumberA = createPullRequest(TEST_REPO, branchA, cloneDir);

      // 4. Trigger PR refresh via 'r' periodically. Also poll via config (5s).
      //    Wait up to 90s for the search API to index the new PR.
      const refreshTimerA = setInterval(() => terminal.write('r'), 10_000);
      terminal.write('r');

      try {
        await expect(
          terminal.getByText(`#${prNumberA}`, { strict: false })
        ).toBeVisible({ timeout: 90_000 });
      } finally {
        clearInterval(refreshTimerA);
      }

      // 5. Now the sidebar order (sorted by PR ID desc for sessions):
      //      index 0: session A (has PR #prNumberA) — sorted first
      //      index 1: session B (no PR) — sorted last
      //    SidebarContext.selectedIndex = 0 → A is selected.

      // 6. Navigate down once to select session B
      terminal.write('j');
      await new Promise((r) => setTimeout(r, 500));

      // 7. Verify session B is selected
      await expect(sidebarLocator(terminal, sessionB).selected()).toBeVisible();

      // 8. Create a PR for branch B — its ID will be higher than A's,
      //    so after refresh it sorts ABOVE A.
      prNumberB = createPullRequest(TEST_REPO, branchB, cloneDir);

      // 9. Wait for B's PR badge to appear
      const refreshTimerB = setInterval(() => terminal.write('r'), 10_000);
      terminal.write('r');

      try {
        await expect(
          terminal.getByText(`#${prNumberB}`, { strict: false })
        ).toBeVisible({ timeout: 90_000 });
      } finally {
        clearInterval(refreshTimerB);
      }

      // 10. After refresh the sort order flipped:
      //       index 0: session B (PR #prNumberB, higher) — now first
      //       index 1: session A (PR #prNumberA, lower)  — now second
      //
      //     BUG: SidebarContext.selectedIndex is still 1 (where B used to be),
      //     but index 1 now points to session A. The selection jumped.

      // Wait for React to settle
      await new Promise((r) => setTimeout(r, 1_000));

      // Assert: selection should still be on session B's PR title
      await expect(
        sidebarLocator(terminal, `e2e: ${branchB}`).selected()
      ).toBeVisible();

      // Assert: selection should NOT be on session A
      expect(
        sidebarLocator(terminal, `e2e: ${branchA}`).selected()
      ).not.toBeVisible();
    } finally {
      // Cleanup GitHub resources (best-effort)
      if (prNumberA) closePullRequest(TEST_REPO, prNumberA);
      if (prNumberB) closePullRequest(TEST_REPO, prNumberB);
      deleteRemoteBranch(TEST_REPO, branchA);
      deleteRemoteBranch(TEST_REPO, branchB);
    }
  }
);
