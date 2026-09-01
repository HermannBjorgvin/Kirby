import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { openPalette, sidebarRow, tab } from './setup/app.js';
import {
  addExternalWorktree,
  cleanupExternalSessions,
  startExternalTmuxSession,
  tmuxAvailable,
  uniqueExternalBranch,
} from './setup/external.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';

/**
 * Two repositories, each with an agent the app did not start: one
 * already running when the app comes up, one found after a switch.
 * Discovery attaches to both and opens their tabs. Moving between the
 * repositories must leave the user where they went: clicking the tab
 * or the row that belongs to the open repo is never a reason to open
 * the other one, whichever way the switch was made.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const ALPHA_BRANCH = 'e2e-ext-alpha';

/** An agent that prints a second line a few seconds in: waiting for it
 *  is how a test proves that time passed with nothing else happening. */
function agentCommand(banner: string): string {
  return `printf '%s\\n' ${banner}; sleep 4; printf '%s\\n' ${banner}-later; sleep 300`;
}

test.use({
  kirbyConfig: { terminalBackend: 'tmux' },
  liveSessions: [
    { branch: ALPHA_BRANCH, command: agentCommand('alpha-agent-here') },
  ],
});

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

/** Wait until the host has attached to the agent on `branch`. */
async function attached(page: Page, branch: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const sessions = await page.evaluate(() => window.kirby.listSessions());
        return sessions.find((s) => s.name === branch)?.running ?? false;
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBe(true);
}

function liveSession(
  repoPath: string,
  homeDir: string,
  branch: string,
  banner: string
): void {
  const worktreePath = addExternalWorktree(repoPath, branch);
  startExternalTmuxSession({
    repoPath,
    homeDir,
    branch,
    worktreePath,
    command: agentCommand(banner),
  });
}

/** Open `name` from the title bar's recent-repositories menu. */
async function switchRepoFromTitleBar(
  page: Page,
  name: string,
  cwd: string
): Promise<void> {
  await page.locator('header').getByRole('button').nth(1).click();
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
  await expect
    .poll(() => page.evaluate(() => window.kirby.getRepo()), {
      timeout: 30_000,
    })
    .toMatchObject({ cwd });
}

async function repoStays(page: Page, cwd: string, tabName: RegExp) {
  await expect(tab(page, tabName)).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
    cwd,
  });
}

test.describe('Discovered sessions across a repo switch', () => {
  test.use({ repo: { name: 'repo-alpha' } });

  let otherRepo: string;
  let betaBranch: string;
  const alphaBranch = ALPHA_BRANCH;

  test.beforeEach(() => {
    otherRepo = createTestRepo({ name: 'repo-beta' });
    betaBranch = uniqueExternalBranch();
  });

  test.afterEach(({ desktop }) => {
    cleanupExternalSessions(desktop.repoPath, [alphaBranch], desktop.homeDir);
    cleanupExternalSessions(otherRepo, [betaBranch], desktop.homeDir);
    cleanupTestRepo(otherRepo);
  });

  test('clicking the open repo’s own tab does not switch repository', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;

    // Alpha's agent was running before the app started; discovery
    // attached and opened its tab. Selecting the row is what a user
    // does to look at it.
    await attached(page, alphaBranch);
    const alphaTab = tab(page, new RegExp(alphaBranch));
    await expect(alphaTab).toBeVisible({ timeout: 30_000 });
    await sidebarRow(page, new RegExp(alphaBranch)).click();
    await expect(page.getByText('alpha-agent-here').first()).toBeVisible({
      timeout: 30_000,
    });

    // Beta has a live agent of its own before it is opened.
    liveSession(otherRepo, homeDir, betaBranch, 'beta-agent-here');
    await switchRepo(page, otherRepo);

    // Discovery in beta opens its tab.
    await attached(page, betaBranch);
    const betaTab = tab(page, new RegExp(`^\\s*${betaBranch}`));
    await expect(betaTab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('beta-agent-here').first()).toBeVisible({
      timeout: 30_000,
    });

    // The user clicks what is in front of them: beta's row, beta's tab.
    await sidebarRow(page, new RegExp(betaBranch)).click();
    await betaTab.click();

    // …and stays in beta.
    await expect(betaTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('beta-agent-here-later').first()).toBeVisible({
      timeout: 30_000,
    });
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: otherRepo,
    });
    await expect(betaTab).toHaveAttribute('aria-selected', 'true');
    await expect(
      tab(page, new RegExp(`repo-alpha\\s*/\\s*${alphaBranch}`))
    ).toHaveAttribute('aria-selected', 'false');
  });

  test('round trips through the recent-repositories menu stay put', async ({
    desktop,
  }) => {
    const { page, repoPath, homeDir } = desktop;
    await attached(page, alphaBranch);
    const alphaOwn = new RegExp(`^\\s*${alphaBranch}`);
    const alphaForeign = new RegExp(`repo-alpha\\s*/\\s*${alphaBranch}`);
    const betaOwn = new RegExp(`^\\s*${betaBranch}`);
    const betaForeign = new RegExp(`repo-beta\\s*/\\s*${betaBranch}`);
    await expect(tab(page, alphaOwn)).toBeVisible({ timeout: 30_000 });
    await sidebarRow(page, new RegExp(alphaBranch)).click();

    liveSession(otherRepo, homeDir, betaBranch, 'beta-agent-here');
    await switchRepo(page, otherRepo);
    await attached(page, betaBranch);
    await expect(tab(page, betaOwn)).toBeVisible({ timeout: 30_000 });
    await repoStays(page, otherRepo, betaOwn);

    // Back to alpha from the title bar, with beta's tab active.
    await switchRepoFromTitleBar(page, 'repo-alpha', repoPath);
    await repoStays(page, repoPath, alphaOwn);
    await sidebarRow(page, new RegExp(alphaBranch)).click();
    await tab(page, alphaOwn).click();
    await expect(page.getByText('alpha-agent-here-later').first()).toBeVisible({
      timeout: 30_000,
    });
    await repoStays(page, repoPath, alphaOwn);
    await expect(tab(page, betaForeign)).toHaveAttribute(
      'aria-selected',
      'false'
    );

    // And to beta again.
    await switchRepoFromTitleBar(page, 'repo-beta', otherRepo);
    await repoStays(page, otherRepo, betaOwn);
    await sidebarRow(page, new RegExp(betaBranch)).click();
    await tab(page, betaOwn).click();
    await expect(page.getByText('beta-agent-here-later').first()).toBeVisible({
      timeout: 30_000,
    });
    await repoStays(page, otherRepo, betaOwn);
    await expect(tab(page, alphaForeign)).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });
});
