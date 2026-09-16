import { execFileSync } from 'node:child_process';
import { findKirbySessionFor, socketEnv } from './setup/tmux.js';
import { sessionBranch } from './setup/session-keys.js';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  openPalette,
  sessionMenu,
  sidebarRow,
  startSessionFromMenu,
  visibleText,
} from './setup/app.js';

test.describe('Session menu', () => {
  test('a new ordinary worktree offers a fresh session without resume or supervision', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const input = await openPalette(page);
    await input.fill('menu-branch');
    await page
      .getByRole('option', {
        name: /Create branch\s*menu-branch\s*and open a worktree/,
      })
      .click();
    const menu = sessionMenu(page);
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole('button', { name: 'Start new session', exact: true })
    ).toBeEnabled();
    await expect(
      menu.getByRole('radio', { name: 'Continue', exact: true })
    ).toHaveCount(0);
    await expect(
      menu.getByRole('radio', { name: 'Review', exact: true })
    ).toHaveCount(0);
    await expect(menu.getByText('Orchestra', { exact: true })).toHaveCount(0);
    await expect(menu.getByRole('combobox', { name: 'Agent' })).toHaveText(
      'Custom (default)'
    );
    await expect(
      menu.getByRole('combobox', { name: /Effort|Model/ })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test('Enter opens the menu and a live session can be reopened without replacement', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await createWorktree(page, 'enter-branch');
    await sidebarRow(page, /enter-branch/).focus();
    await page.keyboard.press('Enter');
    await startSessionFromMenu(page);
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible();
    const before = (
      await page.evaluate(() => window.kirby.listSessions())
    ).find((s) => sessionBranch(s.name) === 'enter-branch');
    expect(before?.running).toBe(true);
    const native = findKirbySessionFor('enter-branch', homeDir)!;
    const processIdentity = () =>
      execFileSync(
        'tmux',
        [
          'display-message',
          '-p',
          '-t',
          `=${native}:`,
          '#{session_id}:#{pane_id}:#{pane_pid}',
        ],
        { env: socketEnv(homeDir), encoding: 'utf8' }
      ).trim();
    const beforeProcess = processIdentity();
    await sidebarRow(page, /enter-branch/).dblclick();
    const menu = sessionMenu(page);
    await expect(
      menu.getByRole('button', { name: 'Open Custom', exact: true })
    ).toBeEnabled();
    await expect(menu.getByText('Orchestra', { exact: true })).toHaveCount(0);
    await menu
      .getByRole('button', { name: 'Open Custom', exact: true })
      .click();
    await expect(menu).toBeHidden();
    const after = (await page.evaluate(() => window.kirby.listSessions())).find(
      (s) => s.name === before?.name
    );
    expect(after?.running).toBe(true);
    expect(processIdentity()).toBe(beforeProcess);
  });

  test('starting fresh explicitly replaces a running agent in the same worktree', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'fresh-branch');
    await sidebarRow(page, /fresh-branch/).dblclick();
    await startSessionFromMenu(page);
    await expect(visibleText(page, 'kirby-fake-agent-ready')).toBeVisible();
    const [before] = await page.evaluate(() => window.kirby.listSessions());
    await sidebarRow(page, /fresh-branch/).dblclick();
    const menu = sessionMenu(page);
    await menu.getByRole('radio', { name: 'New session', exact: true }).click();
    await expect(menu.getByRole('note')).toContainText(
      'stops the running Custom session'
    );
    await menu
      .getByRole('button', { name: 'Stop and start new session', exact: true })
      .click();
    await expect(menu).toBeHidden();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() => window.kirby.listSessions())
          )[0]?.spawnedAt
      )
      .not.toBe(before.spawnedAt);
    const sessions = await page.evaluate(() => window.kirby.listSessions());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ name: before.name, running: true });
  });
});
