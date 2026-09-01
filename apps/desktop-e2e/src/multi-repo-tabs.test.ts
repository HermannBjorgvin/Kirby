import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  openPalette,
  sidebarRow,
  tab,
  tabs,
  visibleText,
} from './setup/app.js';
import { renameSync } from 'node:fs';
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
/** A branch name both checkouts have — the collision case. */
const SHARED = 'shared-name';

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
    await expect(
      tab(page, new RegExp(`${ALPHA}\\s*/\\s*${BRANCH}`))
    ).toHaveCount(1);
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

  test('a foreign tab is inert against a same-named branch in the open repo', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // The discriminating shape: the *same* branch name in both repos,
    // with the agent running in beta. Everything the renderer does with
    // a tab — resolve its sidebar item, decide whether it is running,
    // collect the session to kill on close — goes through a lookup that
    // would match alpha's tab against beta's item without the repo
    // check, and beta is the repo that would lose its agent.
    await createWorktree(page, SHARED);
    await switchRepo(page, otherRepo);
    await createWorktree(page, SHARED);
    await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });

    const foreign = tab(page, new RegExp(`${ALPHA}\\s*/\\s*${SHARED}`));
    await expect(foreign).toHaveCount(1);
    const own = tab(page, new RegExp(`^\\s*${SHARED}`));
    // Positive control: beta's own tab carries the live-agent badge, so
    // the assertion below is about the repo check and not about the
    // badge being absent everywhere.
    await expect(own.locator('.bg-success, .agent-spinner')).not.toHaveCount(0);
    // Beta's agent is live, but the badge belongs to beta's tab alone:
    // alpha's tab must not borrow its item, and so not its running dot.
    await expect(foreign.locator('.bg-success, .agent-spinner')).toHaveCount(0);

    await foreign.getByLabel('Close tab').click();
    await expect(foreign).toHaveCount(0);

    // Beta's agent survived its neighbour's tab closing.
    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(sessions.find((s) => s.name === SHARED)?.running).toBe(true);
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible();
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: otherRepo,
    });
    expect(repoPath).not.toBe(otherRepo);
  });

  test('a tab whose repository has gone offers to reopen it', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // Both repos hold SHARED, so beta has a row that alpha's tab could
    // wrongly light up while it is the active one.
    await createWorktree(page, SHARED);
    await switchRepo(page, otherRepo);
    await createWorktree(page, SHARED);
    const betaRow = sidebarRow(page, new RegExp(SHARED));
    // Positive control: beta's own tab is active, so its row is lit.
    await expect(betaRow).toHaveClass(/bg-sidebar-active/);

    // The checkout the tab points at moves out from under it while the
    // tab sits on the strip. Activating it cannot switch repo, so the
    // pane has to say so rather than spin.
    const moved = `${repoPath}-moved`;
    renameSync(repoPath, moved);
    await tab(page, new RegExp(ALPHA)).click();

    const retry = page.getByRole('button', {
      name: new RegExp(`Open ${ALPHA}`),
    });
    await expect(page.getByText(/This tab belongs to/)).toBeVisible();
    await expect(retry).toBeVisible();
    // The failed open left the workspace where it was, and did not
    // retry itself into a loop.
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: otherRepo,
    });
    // Alpha's tab is the active one, but it is alpha's — beta's
    // same-named row is not what it selects.
    await expect(betaRow).not.toHaveClass(/bg-sidebar-active/);

    // Put it back: the retry is the way out, so it has to actually open
    // the repository rather than decorate the pane.
    renameSync(moved, repoPath);
    await retry.click();
    await expect
      .poll(() => page.evaluate(() => window.kirby.getRepo()), {
        timeout: 30_000,
      })
      .toMatchObject({ cwd: repoPath });
    await expect(tab(page, new RegExp(`^\\s*${SHARED}`))).toBeVisible();
  });
});
