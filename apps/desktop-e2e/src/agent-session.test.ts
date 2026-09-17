import { sessionBranch, sessionKey } from './setup/session-keys.js';
import type { Page } from '@playwright/test';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  agentSpinner,
  createWorktree,
  launchAgentFromRail,
  tab,
} from './setup/app.js';

const BRANCH = 'agent-work';
/** Branch used by this fixture's worktree agent. */
const SESSION = BRANCH;

async function launchAgent(page: Page) {
  await launchAgentFromRail(page);
  await expect(page.getByText('n10-fake-agent-ready').first()).toBeVisible({
    timeout: 30_000,
  });
}

function closeTabButton(page: Page) {
  return page
    .getByRole('tab', { name: new RegExp(BRANCH) })
    .getByLabel('Close tab');
}

async function sessionRunning(page: Page): Promise<boolean> {
  const sessions = await page.evaluate(() => window.n10.listSessions());
  return (
    sessions.find((s) => sessionBranch(s.name) === SESSION)?.running ?? false
  );
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
    await page.evaluate(
      (name) => window.n10.killSession(name),
      await sessionKey(page, BRANCH)
    );
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

    const sessions = await page.evaluate(() => window.n10.listSessions());
    expect(sessions.map((s) => sessionBranch(s.name))).toContain(SESSION);
    expect(
      sessions.find((s) => sessionBranch(s.name) === SESSION)?.running
    ).toBe(true);
  });

  test('closing the tab of an idle agent kills it without asking', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, BRANCH);
    await launchAgent(page);

    // The banner may be suppressed as resize echo, so an idle agent need
    // never show a busy spinner. Wait for its real hosted process and an
    // explicit idle snapshot, then let the renderer's poll catch up.
    await expect.poll(() => sessionRunning(page)).toBe(true);
    const name = await sessionKey(page, BRANCH);
    await expect
      .poll(() =>
        page.evaluate(
          async (key) => (await window.n10.getSessionActivity())[key],
          name
        )
      )
      .toMatchObject({ active: false });
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
  test.use({ n10Config: { aiCommand: fakeAgent({ stream: true }) } });

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
