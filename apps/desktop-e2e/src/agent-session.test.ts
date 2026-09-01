import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { agentSpinner, createWorktree, tab } from './setup/app.js';

const BRANCH = 'agent-work';
/** Session names are the branch with slashes flattened. */
const SESSION = BRANCH;

async function launchAgent(page: Page) {
  // "Launch agent" on a fresh worktree, "Relaunch agent" once a
  // session has existed — match both spellings rather than pinning
  // copy this test isn't about.
  await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
  await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
    timeout: 30_000,
  });
}

function closeTabButton(page: Page) {
  return page
    .getByRole('tab', { name: new RegExp(BRANCH) })
    .getByLabel('Close tab');
}

async function sessionRunning(page: Page): Promise<boolean> {
  const sessions = await page.evaluate(() => window.kirby.listSessions());
  return sessions.find((s) => s.name === SESSION)?.running ?? false;
}

test.describe('Agent sessions', () => {
  /**
   * The sidebar names a would-be session for every worktree, whether or
   * not one was ever launched. Reading that name as "a session exists"
   * offered to *re*launch an agent that had never run, and mounted a
   * terminal pane with no PTY behind it.
   */
  test('a worktree with no agent offers to launch one, not relaunch', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, BRANCH);

    await expect(
      page.getByRole('button', { name: 'Launch agent', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Relaunch agent/i })
    ).toHaveCount(0);

    // And once one has run, it is a relaunch.
    await launchAgent(page);
    await page.evaluate(() => window.kirby.killSession('agent-work'));
    await expect(
      page.getByRole('button', { name: /Relaunch agent/i })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('launching an agent starts a session and shows its output', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, BRANCH);
    await launchAgent(page);

    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(sessions.map((s) => s.name)).toContain(SESSION);
    expect(sessions.find((s) => s.name === SESSION)?.running).toBe(true);
  });

  test('closing the tab of an idle agent kills it without asking', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, BRANCH);
    await launchAgent(page);

    // `useCloseTabs` branches on the renderer's polled activity query,
    // and the banner makes the agent read as active for a moment after
    // launch. Both edges have to be observed: waiting only for the
    // spinner to be *absent* is satisfied before it has ever rendered,
    // so the close could land on a query that had not yet reported the
    // banner — and then did. Wait for the UI to consider the agent busy,
    // the same state the sibling test asserts on, and only then for it
    // to settle.
    await expect(agentSpinner(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(agentSpinner(page)).toHaveCount(0, { timeout: 15_000 });

    await closeTabButton(page).click();

    await expect(page.getByText('Agent is still working')).toHaveCount(0);
    await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0);

    // The PTY is gone, not merely detached from the tab.
    await expect
      .poll(() => sessionRunning(page), { timeout: 15_000 })
      .toBe(false);
  });
});

test.describe('Agent sessions (busy agent)', () => {
  // Never stops producing output, so the activity registry keeps
  // `active` set and the close has to ask first.
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ stream: true }) } });

  test('closing the tab of a working agent asks before killing it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, BRANCH);
    await launchAgent(page);

    // Wait for the UI itself to consider the agent busy — that is the
    // state `useCloseTabs` branches on.
    await expect(agentSpinner(page).first()).toBeVisible({ timeout: 15_000 });

    await closeTabButton(page).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Agent is still working')).toBeVisible();
    await expect(dialog.getByText(BRANCH, { exact: true })).toBeVisible();

    // Backing out leaves both the tab and the agent alone.
    await dialog.getByRole('button', { name: 'Keep working' }).click();
    await expect(tab(page, new RegExp(BRANCH))).toBeVisible();
    expect(await sessionRunning(page)).toBe(true);

    // Confirming closes the tab and stops the agent.
    await closeTabButton(page).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Stop agent & close' })
      .click();

    await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect
      .poll(() => sessionRunning(page), { timeout: 15_000 })
      .toBe(false);
  });
});
