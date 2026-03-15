import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO, testBranchPrefix } from './setup/constants.js';
import {
  createTestBranch,
  createPullRequest,
  mergePullRequest,
  deleteRemoteBranch,
} from './setup/github.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Everything here runs synchronously before tests. When GH_TOKEN is
// missing the tests are skipped via test.when(), so the setup is
// guarded with an if-block to avoid gh CLI errors.

const prefix = testBranchPrefix();
const branchName = `${prefix}/test-merge`;
const sessionName = branchName.replace(/\//g, '-');
const mainJs = resolve('../cli/dist/main.js');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-integ-clone-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'kirby-integ-home-'));
registerCleanup(cloneDir);
registerCleanup(fakeHome);

if (hasGhToken) {
  // 1. Clone sandbox repo
  execSync(`gh repo clone ${TEST_REPO} "${cloneDir}" -- --single-branch`, {
    stdio: 'pipe',
  });

  // 2. Configure remote URL with token so git push can authenticate
  const token = process.env.GH_TOKEN;
  if (token) {
    execSync(
      `git remote set-url origin https://x-access-token:${token}@github.com/${TEST_REPO}.git`,
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

  // 4. Create branch, push, create PR, merge PR
  createTestBranch(cloneDir, branchName);
  const prNumber = createPullRequest(TEST_REPO, branchName, cloneDir);
  mergePullRequest(TEST_REPO, prNumber);

  // 5. Checkout default branch and sync
  const defaultBranch = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
    cwd: cloneDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .trim()
    .replace('refs/remotes/origin/', '');

  execSync(`git checkout ${defaultBranch}`, { cwd: cloneDir, stdio: 'pipe' });
  execSync('git fetch --all --prune', { cwd: cloneDir, stdio: 'pipe' });
  execSync(`git pull origin ${defaultBranch}`, {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 6. Ensure local branch still exists (recreate if remote-prune deleted it)
  try {
    execSync(`git rev-parse --verify ${branchName}`, {
      cwd: cloneDir,
      stdio: 'pipe',
    });
  } catch {
    execSync(`git branch ${branchName} HEAD`, {
      cwd: cloneDir,
      stdio: 'pipe',
    });
  }

  // 7. Create worktree so Kirby sees it as a session
  const worktreeRel = join('.claude', 'worktrees', sessionName);
  execSync(`git worktree add "${worktreeRel}" "${branchName}"`, {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 8. Write global config with autoDeleteOnMerge enabled
  const kirbyDir = join(fakeHome, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(
    join(kirbyDir, 'config.json'),
    JSON.stringify({ autoDeleteOnMerge: true }),
    'utf-8'
  );

  // 9. Register remote branch cleanup (safety net)
  process.on('exit', () => {
    deleteRemoteBranch(TEST_REPO, branchName);
  });
}

// ── Configure tui-test ─────────────────────────────────────────────
// env is a top-level TestOptions property (not inside program).
// Spread process.env so the child gets PATH, GH_TOKEN, etc., then
// override HOME for config isolation.

test.use({
  program: {
    file: 'node',
    args: [mainJs, cloneDir],
  },
  env: {
    ...process.env,
    HOME: fakeHome,
    TERM: 'xterm-256color',
  },
});

// ── Tests ──────────────────────────────────────────────────────────

test.when(
  hasGhToken,
  'detects merged PR and auto-deletes session',
  async ({ terminal }) => {
    // Wait for Kirby to render
    await expect(
      terminal.getByText('Worktree Sessions', { strict: false })
    ).toBeVisible();

    // Verify our session appears in the sidebar
    await expect(
      terminal.getByText(sessionName, { strict: false })
    ).toBeVisible();

    // Kirby auto-syncs on mount: useRemoteSync → sync() → fetchRemote +
    // fastForwardMainBranch → lastSynced → useMergedBranches detects our
    // merged PR → calls onMergedDelete → performDelete + flashStatus.
    // Wait for the flash message confirming deletion.
    await expect(
      terminal.getByText(`Auto-deleted merged branch: ${branchName}`, {
        strict: false,
      })
    ).toBeVisible({ timeout: 45_000 });

    // Wait for the session list to refresh (proves async deletion finished)
    await expect(terminal.getByText('(no sessions)')).toBeVisible({
      timeout: 10_000,
    });

    // Verify worktree directory was removed
    const worktreePath = join(cloneDir, '.claude', 'worktrees', sessionName);
    expect(existsSync(worktreePath)).toBe(false);

    // Verify local branch was deleted
    let branchExists = true;
    try {
      execSync(`git rev-parse --verify ${branchName}`, {
        cwd: cloneDir,
        stdio: 'pipe',
      });
    } catch {
      branchExists = false;
    }
    expect(branchExists).toBe(false);
  }
);
