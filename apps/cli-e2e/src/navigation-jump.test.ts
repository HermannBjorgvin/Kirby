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
  'selected session stays selected when another session moves to Pull Requests',
  async ({ terminal }) => {
    let prNumberA: number | undefined;

    try {
      // 1. Wait for Kirby to render
      await expect(
        terminal.getByText('Kirby', { strict: false })
      ).toBeVisible();

      // 2. Both sessions appear under "Worktrees" (no PRs yet).
      //    Order is [A, B] — sessions without PRs preserve input order.
      await expect(
        terminal.getByText(sessionA, { strict: false })
      ).toBeVisible();
      await expect(
        terminal.getByText(sessionB, { strict: false })
      ).toBeVisible();

      // 3. Navigate down once to select session B (index 1 within Worktrees)
      terminal.write('j');
      await new Promise((r) => setTimeout(r, 500));

      // 4. Verify session B is selected
      await expect(sidebarLocator(terminal, sessionB).selected()).toBeVisible();

      // 5. Create a PR for branch A. A will move from the Worktrees section
      //    into the Pull Requests section, producing a reorder. Selection
      //    (tracked by stable key `session:<name>`) must stay on B.
      prNumberA = createPullRequest(TEST_REPO, branchA, cloneDir);

      // 6. Trigger PR refresh via 'r' periodically. Also poll via config (5s).
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

      // 7. After refresh:
      //      Worktrees     (1): B   ← still selected
      //      Pull Requests (1): A   (moved here because it now has a PR)

      // Wait for React to settle
      await new Promise((r) => setTimeout(r, 1_000));

      // Assert: selection should still be on session B
      await expect(sidebarLocator(terminal, sessionB).selected()).toBeVisible();

      // Assert: selection should NOT be on session A's PR row
      expect(
        sidebarLocator(terminal, `e2e: ${branchA}`).selected()
      ).not.toBeVisible();
    } finally {
      // Cleanup GitHub resources (best-effort)
      if (prNumberA) closePullRequest(TEST_REPO, prNumberA);
      deleteRemoteBranch(TEST_REPO, branchA);
      deleteRemoteBranch(TEST_REPO, branchB);
    }
  }
);
