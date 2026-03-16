import { test, expect } from '@microsoft/tui-test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO } from './setup/constants.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
const mainJs = resolve('../cli/dist/main.js');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-reviews-clone-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'kirby-reviews-home-'));
const logFile = join(tmpdir(), 'kirby-reviews-debug.log');
registerCleanup(cloneDir);
registerCleanup(fakeHome);

if (hasGhToken) {
  // 1. Clone sandbox repo
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}" -- --single-branch`, {
    stdio: 'pipe',
  });

  // 2. Configure remote URL with token so git commands can authenticate
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

  // 4. Write global config (auto-detect fills vendorProject on startup)
  const kirbyDir = join(fakeHome, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(
    join(kirbyDir, 'config.json'),
    JSON.stringify({}),
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
  'Reviews tab shows fixture PRs in correct categories',
  async ({ terminal }) => {
    // 1. Wait for Kirby to start
    await expect(
      terminal.getByText('Worktree Sessions', { strict: false })
    ).toBeVisible();

    // 2. Switch to Reviews tab
    terminal.write('2');

    // 3. Wait for PR data to load — fixture PRs should appear
    //    kirby-test-runner approved PR #37, so "Approved by You" section exists
    await expect(
      terminal.getByText('Approved by You', { strict: false })
    ).toBeVisible({ timeout: 30_000 });

    // 4. Verify all 3 fixture PRs are visible
    await expect(
      terminal.getByText('Add color support for tile values', { strict: false })
    ).toBeVisible();

    await expect(
      terminal.getByText('Add undo feature with history stack', { strict: false })
    ).toBeVisible();

    await expect(
      terminal.getByText('Add AI solver for auto-play mode', { strict: false })
    ).toBeVisible();

    // 5. Verify "Waiting for Author" section exists (PR #38 has changes requested)
    await expect(
      terminal.getByText('Waiting for Author', { strict: false })
    ).toBeVisible();

    // 6. Verify PR #38 shows comment count (3 inline review comments)
    await expect(
      terminal.getByText('3 comments', { strict: false })
    ).toBeVisible();
  }
);
