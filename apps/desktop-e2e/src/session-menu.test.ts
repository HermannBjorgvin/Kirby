import { test, expect } from './fixtures/desktop.js';
import {
  agentPicker,
  createWorktree,
  openPalette,
  sessionMenu,
  sidebarRow,
  startSessionFromMenu,
  visibleText,
} from './setup/app.js';

// The session menu: what a row offers when its agent is not running,
// and the per-launch agent picker on its session row.
//
// The fixture's fake agent is a custom `aiCommand`, so the picker's
// default row reads "Custom (default)"; the registry agents follow.
// Only the default is ever launched here — the others are real
// binaries this machine need not have.

test.describe('Session menu', () => {
  test('checking out a branch lands in its session menu', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // The shared helper dismisses the menu; drive the palette by hand
    // to see it open.
    const input = await openPalette(page);
    await input.fill('menu-branch');
    await page
      .getByRole('option', {
        name: /Create branch\s*menu-branch\s*and open a worktree/,
      })
      .click();

    const menu = sessionMenu(page);
    await expect(menu).toBeVisible({ timeout: 30_000 });
    await expect(menu.getByText('Start / continue session')).toBeVisible();
    // No pull request → no review rows.
    await expect(menu.getByText('Start / continue review')).toHaveCount(0);
    await expect(agentPicker(page)).toHaveText(/Custom \(default\)/);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Launch agent', exact: true })
    ).toBeVisible();
  });

  test('Enter on an idle row opens the menu, and the default agent starts', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'enter-branch');

    await sidebarRow(page, /enter-branch/).focus();
    await page.keyboard.press('Enter');
    await expect(sessionMenu(page)).toBeVisible();
    await startSessionFromMenu(page);

    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible({
      timeout: 30_000,
    });
    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(sessions.find((s) => s.name === 'enter-branch')?.running).toBe(true);

    // A running agent has nothing to choose: its row opens the tab
    // only. Wait for the sidebar model to agree the agent is running
    // (the rail's Stop appears from the same model) before activating.
    await expect(
      page.getByRole('button', { name: 'Stop agent' }).first()
    ).toBeVisible({ timeout: 15_000 });
    await sidebarRow(page, /enter-branch/).dblclick();
    await expect(sessionMenu(page)).toHaveCount(0);
  });

  test('the picker lists every agent and reopens on the default', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'pick-branch');

    await sidebarRow(page, /pick-branch/).dblclick();
    const menu = sessionMenu(page);
    await expect(menu).toBeVisible();

    await agentPicker(page).click();
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options).toHaveText([
      'Custom (default)',
      'Claude',
      'Codex',
      'Gemini',
      'Copilot',
      'OpenCode',
    ]);
    await options.filter({ hasText: 'Codex' }).click();
    await expect(agentPicker(page)).toHaveText(/Codex/);

    // The pick is per launch: cancelling and reopening is back on the
    // default.
    await menu.getByRole('button', { name: 'Cancel' }).click();
    await expect(menu).toBeHidden();
    await sidebarRow(page, /pick-branch/).dblclick();
    await expect(agentPicker(page)).toHaveText(/Custom \(default\)/);
  });
});
