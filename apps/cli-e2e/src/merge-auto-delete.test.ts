import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO, testBranchPrefix } from './setup/constants.js';
import {
  createLocalBranch,
  pushBranch,
  closePullRequest,
  createPullRequest,
  mergePullRequest,
  deleteRemoteBranch,
} from './setup/github.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Only local/idempotent operations here. GitHub API calls (push,
// create PR, merge) move into the test body so retries or re-imports
// don't create duplicate remote resources.

const prefix = testBranchPrefix();
const branchName = `${prefix}/test-merge`;
const sessionName = branchName.replace(/\//g, '-');
const mainJs = resolve('../cli/dist/main.js');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-integ-clone-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'kirby-integ-home-'));
const logFile = join(tmpdir(), 'kirby-integ-debug.log');
registerCleanup(cloneDir);
registerCleanup(fakeHome);

if (hasGhToken) {
  // 1. Clone sandbox repo
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}" -- --single-branch`, {
    stdio: 'pipe',
  });

  // 2. Configure remote URL with token so git push can authenticate
  const token = process.env.GH_TOKEN;
  if (token) {
    execSync(
      `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
      { cwd: cloneDir, stdio: 'pipe' }
    );
  }

  // 3. Configure git identity
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 4. Create local branch (no push — that happens in the test body)
  createLocalBranch(cloneDir, branchName);

  // 5. Checkout default branch (worktree add requires branch isn't checked out)
  const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
    cwd: cloneDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .trim()
    .replace('refs/remotes/origin/', '');
  execSync(`git checkout "${defaultBranch}"`, { cwd: cloneDir, stdio: 'pipe' });

  // 6. Create worktree so Kirby sees it as a session
  const worktreeRel = join('.claude', 'worktrees', sessionName);
  execSync(`git worktree add "${worktreeRel}" "${branchName}"`, {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 7. Write global config with autoDeleteOnMerge enabled
  const kirbyDir = join(fakeHome, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(
    join(kirbyDir, 'config.json'),
    JSON.stringify({ autoDeleteOnMerge: true }),
    'utf-8'
  );
}

// ── Configure tui-test ─────────────────────────────────────────────
// env is a top-level TestOptions property (not inside program).
// Spread process.env so the child gets PATH, GH_TOKEN, etc., then
// override HOME for config isolation.

test.use({
  rows: 80,
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
  'detects merged PR and auto-deletes session',
  async ({ terminal }) => {
    // 1. Push branch + create PR (GitHub operations, not in module scope)
    pushBranch(cloneDir, branchName);
    const prNumber = createPullRequest(TEST_REPO, branchName, cloneDir);

    try {
      // 2. Wait for Kirby to render
      await expect(
        terminal.getByText('Kirby', { strict: false })
      ).toBeVisible();

      // 3. Verify session appears (PR not merged yet — guaranteed no race)
      await expect(
        terminal.getByText(sessionName, { strict: false })
      ).toBeVisible();

      // 4. Merge the PR now that we've confirmed the session is visible
      mergePullRequest(TEST_REPO, prNumber);

      // 5. Trigger sync periodically — GitHub search API may take 10-30s
      //    to index the merge. Press 'g' (sync shortcut) every 10s.
      const syncTimer = setInterval(() => terminal.write('g'), 10_000);
      terminal.write('g');

      try {
        // 6. Wait for session to disappear (auto-delete removes worktree + branch).
        //    We assert on the persistent "(no sessions)" state rather than the
        //    transient flash message which only lasts 3 seconds.
        await expect(terminal.getByText('(no sessions)')).toBeVisible({
          timeout: 90_000,
        });
      } finally {
        clearInterval(syncTimer);
      }

      // 7. Verify worktree directory was removed
      const worktreePath = join(cloneDir, '.claude', 'worktrees', sessionName);
      expect(existsSync(worktreePath)).toBe(false);

      // 8. Verify local branch was deleted
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

      // 9. Verify the merge commit landed on the local default branch
      //    (sync runs fetchRemote + fastForwardMainBranch)
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
        { cwd: cloneDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      expect(logOutput.trim()).not.toBe('');
    } finally {
      // Cleanup GitHub resources (best-effort)
      closePullRequest(TEST_REPO, prNumber);
      deleteRemoteBranch(TEST_REPO, branchName);
    }
  }
);
