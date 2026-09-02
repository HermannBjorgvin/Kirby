import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { openPalette, sidebar, sidebarRow, tab, tabs } from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * The host holds one repository and answers every sidebar query for
 * whichever one that is; the renderer keys those answers by the repo
 * *it* has open. The two agree except while a switch is in flight —
 * the host has moved on, the previous workspace is still mounted and
 * still polling — and an answer about the new repository landing in
 * the old workspace's cache is reconciled into the old repository's
 * tabs: a tab stamped with the repo being left, named after a branch
 * that exists only in the one being entered. It shows up beside the
 * real tab under the other repo's name, and activating it opens that
 * repo — with nothing to show there.
 *
 * The window is held open here by switching the host through the
 * bridge alone, which is what the renderer sees during the few frames
 * a real switch takes.
 */

const ALPHA = 'repo-alpha';
const BETA = 'repo-beta';
const ALPHA_BRANCH = 'alpha-only';
const BETA_BRANCH = 'beta-only';

async function switchRepo(page: Page, cwd: string): Promise<void> {
  await openPalette(page);
  await page.getByRole('option', { name: /Open another repository/ }).click();
  await page.getByPlaceholder('/path/to/repository').fill(cwd);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.kirby.getRepo()), {
      timeout: 30_000,
    })
    .toMatchObject({ cwd });
}

test.describe('A sidebar answer about another repository', () => {
  test.use({
    repo: { name: ALPHA, worktrees: [{ branch: ALPHA_BRANCH }] },
  });

  let otherRepo: string;

  test.beforeEach(() => {
    otherRepo = createTestRepo({
      name: BETA,
      worktrees: [{ branch: BETA_BRANCH }],
    });
  });

  test.afterEach(() => {
    cleanupTestRepo(otherRepo);
  });

  test('never becomes a tab of the repository in view', async ({ desktop }) => {
    const { page } = desktop;
    await expect(tabs(page)).toHaveCount(0);

    // The host moves to beta and starts an agent there, while the
    // renderer still shows alpha — the state a switch passes through.
    await page.evaluate(
      async ({ cwd, branch }) => {
        await window.kirby.openRepo(cwd);
        await window.kirby.launchAgent({
          branch,
          intent: 'continue-or-blank',
        });
      },
      { cwd: otherRepo, branch: BETA_BRANCH }
    );

    // Force alpha's workspace to ask the host again, and wait until an
    // answer has landed — the sidebar stamps when its rows last came
    // back, which is the only thing an answer about beta changes. Alpha
    // keeps its own rows rather than showing beta's, and none of beta's
    // becomes a tab here.
    const landedBefore = await sidebar(page).getAttribute('data-updated-at');
    await sidebar(page).getByLabel('Refresh').click();
    await expect(sidebar(page)).not.toHaveAttribute(
      'data-updated-at',
      landedBefore ?? ''
    );
    await expect(sidebarRow(page, new RegExp(ALPHA_BRANCH))).toBeVisible();
    await expect(sidebarRow(page, new RegExp(BETA_BRANCH))).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(0);

    // Now the renderer catches up with the host. Beta's own tab opens
    // for the running agent; there is no second one under alpha's name.
    await switchRepo(page, otherRepo);
    await expect(tab(page, new RegExp(`^\\s*${BETA_BRANCH}`))).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      tab(page, new RegExp(`${ALPHA}\\s*/\\s*${BETA_BRANCH}`))
    ).toHaveCount(0);
    await expect(tabs(page)).toHaveCount(1);
  });
});
