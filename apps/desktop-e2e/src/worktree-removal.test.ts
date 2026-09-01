import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, fakeAgent } from './fixtures/desktop.js';
import {
  agentSpinner,
  createWorktree,
  launchAgentFromRail,
  sidebarRow,
  tab,
} from './setup/app.js';
import { armContextMenuChoice, armContextMenuDismiss } from './setup/menu.js';

const BRANCH = 'doomed';

async function openRemoveDialog(page: Page, app: ElectronApplication) {
  await armContextMenuChoice(app, 'Remove worktree…');
  await sidebarRow(page, new RegExp(BRANCH)).click({ button: 'right' });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Remove worktree?')).toBeVisible();
  return dialog;
}

/**
 * The test repo has no remote, so the host reports the branch as "not
 * pushed to upstream" — an overridable reason, which turns the confirm
 * button into "Force remove". Take whichever is offered.
 */
function confirmButton(dialog: Locator) {
  return dialog.getByRole('button', { name: /^(Remove|Force remove)$/ });
}

test.describe('Worktree removal', () => {
  test('removing from the context menu drops the row, the tab and the directory', async ({
    desktop,
  }) => {
    const { page, app, repoPath } = desktop;
    await createWorktree(page, BRANCH);
    const worktreeDir = join(repoPath, '.claude', 'worktrees', BRANCH);
    expect(existsSync(worktreeDir)).toBe(true);

    const dialog = await openRemoveDialog(page, app);
    await confirmButton(dialog).click();

    // The row and tab go immediately — removal is optimistic — and the
    // directory follows once git finishes.
    await expect(sidebarRow(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect(tab(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect
      .poll(() => existsSync(worktreeDir), { timeout: 20_000 })
      .toBe(false);
  });

  test('cancelling leaves the worktree alone', async ({ desktop }) => {
    const { page, app, repoPath } = desktop;
    await createWorktree(page, BRANCH);

    const dialog = await openRemoveDialog(page, app);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Remove worktree?')).toHaveCount(0);
    await expect(sidebarRow(page, new RegExp(BRANCH))).toBeVisible();
    expect(existsSync(join(repoPath, '.claude', 'worktrees', BRANCH))).toBe(
      true
    );
  });

  test('dismissing the context menu without choosing does nothing', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await createWorktree(page, BRANCH);

    await armContextMenuDismiss(app);
    await sidebarRow(page, new RegExp(BRANCH)).click({ button: 'right' });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(sidebarRow(page, new RegExp(BRANCH))).toBeVisible();
  });
});

test.describe('Worktree removal (running agent)', () => {
  test.use({ kirbyConfig: { aiCommand: fakeAgent({ stream: true }) } });

  test('removing a worktree stops the agent running in it', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    await createWorktree(page, BRANCH);

    await launchAgentFromRail(page);
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(agentSpinner(page).first()).toBeVisible({ timeout: 15_000 });

    const dialog = await openRemoveDialog(page, app);
    // The dialog says so out loud when an agent is running.
    await expect(dialog.getByText(/stops its running agent/)).toBeVisible();
    await confirmButton(dialog).click();

    await expect(sidebarRow(page, new RegExp(BRANCH))).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const sessions = await page.evaluate(() =>
            window.kirby.listSessions()
          );
          return sessions.find((s) => s.name === BRANCH)?.running ?? false;
        },
        { timeout: 20_000 }
      )
      .toBe(false);
  });
});
