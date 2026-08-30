import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { newWorktreeButton, sidebar, sidebarRow, tabs } from './setup/app.js';
import { armContextMenuChoice } from './setup/menu.js';

/**
 * Agents do things to their own worktree that a person rarely does by
 * hand: start a rebase and stop on a conflict, check out a different
 * branch, end up on a detached HEAD. Each leaves git in a state where
 * the directory name, the checked-out branch and the branch Kirby
 * thinks it is looking at stop agreeing.
 *
 * None of these should be able to take the window down, and the
 * destructive path in particular has to refuse where git would lose
 * work.
 *
 * The fixture fails any test whose renderer throws, so "the app is
 * still usable" is asserted throughout, not only where it is written.
 */

/** The workspace rendered rather than a blank window or the picker. */
async function workspaceIsUsable(page: Page) {
  await expect(newWorktreeButton(page)).toBeVisible();
  await expect(sidebar(page)).toBeVisible();
}

test.describe('A worktree stopped mid-rebase', () => {
  test.use({
    repo: {
      worktrees: [{ branch: 'rebasing-branch', conflictedRebase: true }],
    },
  });

  test('appears in the sidebar, flagged, rather than vanishing', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await workspaceIsUsable(page);

    // git reports no branch for a mid-rebase worktree; Kirby recovers
    // the name from the rebase state, so the row must still be there.
    const row = sidebarRow(page, /rebasing-branch/);
    await expect(row).toBeVisible();
    await expect(row.getByText('rebasing', { exact: true })).toBeVisible();
  });

  test('refuses removal outright, with no force option', async ({
    desktop,
  }) => {
    const { page, app, repoPath } = desktop;

    await armContextMenuChoice(app, 'Remove worktree…');
    await sidebarRow(page, /rebasing-branch/).click({ button: 'right' });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Cannot delete')).toBeVisible();
    await expect(dialog.getByText('rebase in progress')).toBeVisible();
    // Force-removing would destroy the in-progress rebase, so unlike
    // "not pushed to upstream" this one is not overridable.
    await expect(
      dialog.getByRole('button', { name: /^(Remove|Force remove)$/ })
    ).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(
      existsSync(join(repoPath, '.claude', 'worktrees', 'rebasing-branch'))
    ).toBe(true);
  });

  test('opens its tab without breaking the diff pane', async ({ desktop }) => {
    const { page } = desktop;
    await sidebarRow(page, /rebasing-branch/).click();
    // A conflicted rebase leaves a detached HEAD and conflict markers in
    // the tree; the diff still has to render something rather than
    // throwing inside the pane.
    await expect(tabs(page)).toHaveCount(1);
    await expect(
      page.getByText(/files? changed|No changes between/)
    ).toBeVisible({ timeout: 30_000 });
  });
});

test.describe('A worktree on a detached HEAD', () => {
  test.use({
    repo: { worktrees: [{ branch: 'detached-branch', detach: true }] },
  });

  test('still lists and opens, named after its directory', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await workspaceIsUsable(page);

    // No branch and no rebase to recover one from: the row falls back
    // to the directory name so the worktree is not simply lost.
    const row = sidebarRow(page, /detached-branch/);
    await expect(row).toBeVisible();
    await row.click();
    await expect(tabs(page)).toHaveCount(1);
  });

  test('is reported by the host as a worktree with no branch', async ({
    desktop,
  }) => {
    const worktrees = await desktop.page.evaluate(() =>
      window.kirby.listWorktrees()
    );
    const detached = worktrees.find((w) => w.path.endsWith('detached-branch'));
    expect(detached).toBeDefined();
    expect(detached?.branch).toBe('');
  });
});

test.describe('A worktree whose branch was switched inside it', () => {
  test.use({
    repo: {
      worktrees: [{ branch: 'original', switchTo: 'agent-side-branch' }],
    },
  });

  test('follows the branch that is actually checked out', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await workspaceIsUsable(page);

    // The directory is still `original`, but git says the checkout is
    // on `agent-side-branch` — the sidebar reports what git reports.
    await expect(sidebarRow(page, /agent-side-branch/)).toBeVisible();

    const worktrees = await page.evaluate(() => window.kirby.listWorktrees());
    const found = worktrees.find((w) => w.path.endsWith('original'));
    expect(found?.branch).toBe('agent-side-branch');
  });

  test('resolves the existing directory rather than making a second one', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // Checking `original` out again must reuse its directory: the
    // worktree resolver is keyed by directory name precisely so a
    // branch switched underneath does not strand it.
    await page.evaluate(
      (branch) =>
        window.kirby.launchAgent({ branch, intent: 'continue-or-blank' }),
      'original'
    );

    expect(existsSync(join(repoPath, '.claude', 'worktrees', 'original'))).toBe(
      true
    );
    const worktrees = await page.evaluate(() => window.kirby.listWorktrees());
    expect(worktrees.filter((w) => w.path.endsWith('original'))).toHaveLength(
      1
    );
  });
});

test.describe('A worktree whose directory was deleted', () => {
  test.use({
    repo: { worktrees: [{ branch: 'ghost', deleteDirectory: true }] },
  });

  test('does not stop the app from starting', async ({ desktop }) => {
    // git still has the registration; every path that shells into the
    // directory now fails. The window must still come up.
    await workspaceIsUsable(desktop.page);
    await expect(sidebarRow(desktop.page, /ghost/)).toBeVisible();
  });

  test('can still be removed, which is how the user cleans it up', async ({
    desktop,
  }) => {
    const { page, app } = desktop;
    // git keeps listing a worktree whose directory is gone until
    // something prunes it, so the row is there to act on.
    const row = sidebarRow(page, /ghost/);
    await expect(row).toBeVisible();

    await armContextMenuChoice(app, 'Remove worktree…');
    await row.click({ button: 'right' });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remove worktree?')).toBeVisible();
    await dialog
      .getByRole('button', { name: /^(Remove|Force remove)$/ })
      .click();

    await expect(sidebarRow(page, /ghost/)).toHaveCount(0);
  });
});
