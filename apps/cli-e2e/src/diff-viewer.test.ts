import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { TEST_REPO } from './setup/constants.js';

// Regression test for the diff viewer. The DiffPane was split into
// DiffFileListContainer + DiffFileViewerContainer (refactor step H1).
// Each container mounted its own useDiffData() hook — so the diff text
// loaded by the list never reached the viewer, and opening a file
// always showed "(no diff for this file)". This test opens a real
// fixture PR, navigates into a file, and asserts the viewer actually
// renders diff content.

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-diff-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  // No --single-branch here: Kirby resolves fixture branches via
  // `origin/<branch>` which requires a full refspec, and the diff
  // viewer fetches source/target refs at open time.
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
  // Pre-fetch the fixture source branch so the viewer's resolveRef
  // hits the local remote ref immediately.
  execSync('git fetch origin fixture/add-color-support', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

test.describe('@integration Diff Viewer', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

  test('opening a file in the diff list renders its diff content', async ({
    kirby,
  }) => {
    // 1. Wait for review PR data to load and fixture PR #37 to appear.
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(
      kirby.term.getByText('Add color support for tile values').first()
    ).toBeVisible({ timeout: 30_000 });

    // 2. Navigate the sidebar selection onto PR #37 and confirm it's
    //    selected (the icon is ◉ or ◎).
    const pr37 = sidebarLocator(kirby.term.page, 'Add color support');
    while ((await pr37.selected().count()) === 0) {
      await kirby.term.press('j');
    }
    await expect(pr37.selected().first()).toBeVisible();

    // 3. Press `d` to open the diff file list for the selected PR.
    await kirby.term.press('d');

    // Wait for the file list to load — fixture PR #37 modifies the 2048
    // game source, so we expect a .c or .h file to appear.
    await kirby.term.page
      .locator('.term-row', { hasText: /\.(c|h)\b/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // 4. Press Enter to open the selected file in the diff viewer.
    await kirby.term.press('Enter');

    // 5. The diff viewer should render actual diff content — NOT the
    //    "(no diff for this file)" empty-state message.
    //    Wait up to 30s for the diff text to fetch from GitHub.
    await expect(
      kirby.term.getByText('(no diff for this file)')
    ).not.toBeVisible({ timeout: 30_000 });

    // 6. Positive assertion: a unified-diff hunk header (`@@ … @@`)
    //    should be visible. Every non-empty diff has at least one.
    await expect(
      kirby.term.page.locator('.term-row', { hasText: /@@.*@@/ }).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
