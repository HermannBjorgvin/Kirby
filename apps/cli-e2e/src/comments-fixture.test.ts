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

  // Helper: select PR #38 in the sidebar, open the file list, navigate
  // the selection onto `src/undo.c` (which has 2 remote inline comments
  // — Makefile and other files have none), then open its diff.
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
    // Wait for the file list to populate — a .c file (e.g. src/undo.c)
    // appears once the diff is fetched.
    await kirby.term.page
      .locator('.term-row', { hasText: /\.(c|h)\b/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Navigate the file-list selection to src/undo.c. The selected row
    // carries the '›' prefix (see DiffFileList.tsx:44). Without this we
    // open the default selection (Makefile), which has no comments.
    const undoSelected = kirby.term.page.locator('.term-row', {
      hasText: /›.*undo\.c/,
    });
    for (let i = 0; i < 20; i++) {
      if ((await undoSelected.count()) > 0) break;
      await kirby.term.press('j');
    }
    await expect(undoSelected.first()).toBeVisible();

    await kirby.term.press('Enter');
    await expect(
      kirby.term.getByText('(no diff for this file)')
    ).not.toBeVisible({ timeout: 30_000 });
  }

  test('PR #38 diff viewer shows inline remote comments with author and body', async ({
    kirby,
  }) => {
    await openPr38DiffFileWithComments({ term: kirby.term });

    // kirby-test-runner authored both inline comments on src/undo.c.
    // This is "another user" from the PR author's perspective
    // (PR #38 is authored by HermannBjorgvin).
    await expect(kirby.term.getByText('kirby-test-runner').first()).toBeVisible(
      { timeout: 15_000 }
    );

    // Body of the first undo.c comment (line 9) should be rendered
    // verbatim — at least the opening phrase. Proves Kirby pulls the
    // real comment content, not just the author.
    await expect(kirby.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('cycling through remote threads with c reveals each comment body', async ({
    kirby,
  }) => {
    await openPr38DiffFileWithComments({ term: kirby.term });

    // Wait for the first comment to render.
    await expect(kirby.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 15_000,
    });

    // src/undo.c has 2 inline comments. Selecting the first thread
    // (c in vim preset) expands its body — and the "[r]eply [v]resolve"
    // hint appears in the header, confirming the selection landed.
    await kirby.term.press('c');
    await expect(kirby.term.getByText(/\[r\]eply/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Press c again to cycle to the second thread. Its body mentions
    // inconsistent parameter naming.
    await kirby.term.press('c');
    await expect(
      kirby.term.getByText(/Inconsistent parameter/).first()
    ).toBeVisible({ timeout: 5_000 });
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

  test('posting a reply makes it appear in the thread with the replier as author', async ({
    kirby,
  }) => {
    await openPr38DiffFileWithComments({ term: kirby.term });

    // Wait for remote comments to load, then select the first thread.
    await expect(kirby.term.getByText('kirby-test-runner').first()).toBeVisible(
      { timeout: 15_000 }
    );
    await kirby.term.press('c');

    // Unique marker — each CI run gets a distinct body so we can find
    // our own reply among any accumulated from previous runs.
    const marker = `e2ereply${Date.now().toString(36)}`;

    await kirby.term.press('r');
    await expect(kirby.term.getByText('REPLY').first()).toBeVisible({
      timeout: 5_000,
    });

    await kirby.term.type(marker, { delay: 10 });
    await kirby.term.press('Enter');

    // Status flash confirms the API round-trip.
    await expect(
      kirby.term.getByText(/Reply (posted|failed)/).first()
    ).toBeVisible({ timeout: 20_000 });

    // The reply body must render inline in the thread. Proves the
    // optimistic-update path actually hangs the reply off the thread.
    await expect(kirby.term.getByText(new RegExp(marker)).first()).toBeVisible({
      timeout: 10_000,
    });

    // A 2-comment thread renders two author headers — both are
    // kirby-test-runner (same PAT). The reply separator row carries
    // the author again, so we expect at least 2 matches.
    await expect(
      kirby.term.page
        .locator('.term-row')
        .filter({ hasText: 'kirby-test-runner' })
    ).toHaveCount(2, { timeout: 10_000 });
  });

  test('Shift+C opens the general-comments pane and Esc returns to pr-detail', async ({
    kirby,
  }) => {
    // Select PR #38 in the sidebar.
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

    // Open the general-comments pane (vim preset binds this to plain C).
    await kirby.term.press('C');

    // Either the pane lists PR comments (header "PR Comments") or it
    // shows the empty state — both exercise the routing path.
    await expect(
      kirby.term.getByText(/PR Comments|No general comments/).first()
    ).toBeVisible({ timeout: 10_000 });

    // Esc returns to pr-detail — the signature hint line is visible
    // again ("press d to view diff").
    await kirby.term.press('Escape');
    await expect(
      kirby.term.getByText('press d to view diff').first()
    ).toBeVisible({ timeout: 5_000 });
  });
});
