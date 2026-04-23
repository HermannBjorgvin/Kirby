import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { TEST_REPO } from './setup/constants.js';

// Exercises the remote-comment sync feature end-to-end against the
// fixture PR #38 (undo feature), which has 3 inline review comments.

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-comments-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  // Full clone (no --single-branch): the diff viewer resolves both
  // source and target refs, so it needs all fixture branches available.
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}"`, { stdio: 'pipe' });
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
  execSync('git fetch origin fixture/add-undo-feature', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

test.describe('@integration Comments Fixture', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

  // Helper: select PR #38 in the sidebar and open its diff viewer on
  // the first file that contains remote inline comments.
  async function openPr38DiffFileWithComments(kirby: {
    term: {
      page: Page;
      press: (k: string) => Promise<void>;
      getByText: Page['getByText'];
    };
  }) {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(
      kirby.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    const pr38 = sidebarLocator(kirby.term.page, 'Add undo feature');
    for (let i = 0; i < 20; i++) {
      if ((await pr38.selected().count()) > 0) break;
      await kirby.term.press('j');
    }
    await expect(pr38.selected().first()).toBeVisible();

    await kirby.term.press('d');
    await kirby.term.page
      .locator('.term-row', { hasText: /\.(c|h)\b/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    await kirby.term.press('Enter');
    await expect(
      kirby.term.getByText('(no diff for this file)')
    ).not.toBeVisible({ timeout: 30_000 });
  }

  test('PR #38 diff viewer shows inline remote comments with author names', async ({
    kirby,
  }) => {
    await openPr38DiffFileWithComments({ term: kirby.term });

    // kirby-test-runner authored all 3 inline comments on PR #38.
    await expect(kirby.term.getByText('kirby-test-runner').first()).toBeVisible(
      { timeout: 15_000 }
    );
  });

  test('selecting a remote thread and pressing v toggles resolved state', async ({
    kirby,
  }) => {
    await openPr38DiffFileWithComments({ term: kirby.term });

    // c = next-comment in vim preset
    await kirby.term.press('c');
    await kirby.term.press('v');
    await expect(
      kirby.term.getByText(/Resolving|Resolved|Reopening|Reopened/).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('reply mode activates on r and shows posting status after submit', async ({
    kirby,
  }) => {
    await openPr38DiffFileWithComments({ term: kirby.term });

    await kirby.term.press('c');
    await kirby.term.press('r');
    await expect(kirby.term.getByText('REPLY').first()).toBeVisible({
      timeout: 5_000,
    });

    await kirby.term.type('e2e test reply', { delay: 10 });
    await kirby.term.press('Enter');

    await expect(
      kirby.term.getByText(/Reply (posted|failed)/).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
