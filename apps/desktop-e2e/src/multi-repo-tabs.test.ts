import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  openPalette,
  tab,
  tabs,
  visibleText,
} from './setup/app.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * The tab strip outlives a repository switch: tabs from the repo you
 * left stay put, marked with its name, so an agent running over there
 * is still on screen and one click away.
 *
 * The host holds one repository at a time, so a foreign tab's content
 * cannot be rendered while another repo is open — activating one opens
 * its repository, and the workspace follows. That round trip is what
 * this drives, through the real IPC, with a real second checkout on
 * disk and a real (fake) agent running in the first.
 *
 * Switching goes through the palette and the repo picker rather than
 * `window.kirby.openRepo`: the bridge call switches the *host* only,
 * and the renderer would never learn about it — which is precisely the
 * seam under test.
 */

const BRANCH = 'alpha-work';
const ALPHA = 'repo-alpha';
const BETA = 'repo-beta';

/** Leave the current repository and open `cwd` through the picker. */
async function switchRepo(page: Page, cwd: string): Promise<void> {
  // No filter typed: the palette's own `value` for this entry is
  // "command switch open repository", so searching for the words on
  // screen scores it out of the list.
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

test.describe('Tabs across repositories', () => {
  test.use({ repo: { name: ALPHA } });

  let otherRepo: string;

  test.beforeEach(() => {
    otherRepo = createTestRepo({ name: BETA });
  });

  test.afterEach(() => {
    cleanupTestRepo(otherRepo);
  });

  test('a tab survives the switch, comes back with its terminal, and closes', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // An agent running in repo alpha, in its own tab.
    await createWorktree(page, BRANCH);
    await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    await expect(tab(page, new RegExp(BRANCH))).toBeVisible();

    await switchRepo(page, otherRepo);

    // The tab is still there, and now says which repository it is from.
    const foreign = tab(page, new RegExp(`${ALPHA}\\s*/\\s*${BRANCH}`));
    await expect(foreign).toBeVisible();
    await expect(foreign).toHaveAttribute('title', repoPath);
    // …but its content is not: beta is in view, and it has no tabs.
    await expect(page.getByText('kirby-fake-agent-ready')).toBeHidden();

    // Activating it brings alpha back — sidebar, status bar and all.
    await foreign.click();
    await expect
      .poll(() => page.evaluate(() => window.kirby.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: repoPath });

    // The agent kept running the whole time, and its scrollback is
    // replayed from the host's buffer into the remounted terminal.
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    await expect(tab(page, new RegExp(`^\\s*${BRANCH}`))).toBeVisible();

    // And it closes like any other tab.
    await tab(page, new RegExp(BRANCH)).getByLabel('Close tab').click();
    await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0);
  });

  test('two repositories keep a tab each for the same branch name', async ({
    desktop,
  }) => {
    const { page } = desktop;

    // `main` exists in both checkouts, so both sidebars produce the
    // same item key — and the host names both PTY sessions `main`.
    await createWorktree(page, BRANCH);
    await expect(tab(page, new RegExp(BRANCH))).toBeVisible();

    await switchRepo(page, otherRepo);
    await createWorktree(page, BRANCH);

    // One tab each, not one shared tab.
    await expect(tabs(page)).toHaveCount(2);
    await expect(tab(page, new RegExp(`${ALPHA}\\s*/\\s*${BRANCH}`))).toHaveCount(
      1
    );
    await expect(tab(page, new RegExp(`^\\s*${BRANCH}`))).toHaveCount(1);
  });

  test('closing a foreign tab leaves the other repository’s agent running', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    await createWorktree(page, BRANCH);
    await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });

    await switchRepo(page, otherRepo);
    await tab(page, new RegExp(ALPHA)).getByLabel('Close tab').click();
    await expect(tabs(page)).toHaveCount(0);

    // The host refuses to touch another repository's session, so the
    // close cannot have killed it — the agent is still there when
    // alpha comes back.
    await switchRepo(page, repoPath);
    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(sessions.find((s) => s.name === BRANCH)?.running).toBe(true);
  });
});
