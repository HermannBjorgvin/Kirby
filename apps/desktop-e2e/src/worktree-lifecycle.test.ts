import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  dismissSessionMenu,
  openPalette,
  paletteInput,
  sidebarRow,
  tab,
  tabs,
} from './setup/app.js';

test.describe('Worktree lifecycle', () => {
  test('creating a branch from the palette makes a worktree, a sidebar row and a tab', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    const branch = 'feature-alpha';

    await createWorktree(page, branch);

    // A real worktree on disk, in the default location…
    expect(existsSync(join(repoPath, '.claude', 'worktrees', branch))).toBe(
      true
    );
    // …that git itself reports, so this isn't just a stray directory.
    const worktrees = await page.evaluate(() => window.kirby.listWorktrees());
    expect(worktrees.map((w) => w.branch)).toContain(branch);

    await expect(tab(page, new RegExp(branch))).toBeVisible();
  });

  test('a second worktree adds a second row and a second tab', async ({
    desktop,
  }) => {
    const { page } = desktop;

    await createWorktree(page, 'feature-one');
    await createWorktree(page, 'feature-two');

    await expect(sidebarRow(page, /feature-one/)).toBeVisible();
    await expect(sidebarRow(page, /feature-two/)).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
  });
});

test.describe('Checking out an existing branch', () => {
  test.use({ repo: { branches: ['existing-work'] } });

  test('checks out into a worktree instead of offering to create it', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    const input = await openPalette(page);
    await input.fill('existing-work');

    // The branch already exists, so the "Create" group must stay away —
    // creating it again would fail in git.
    await expect(
      page.getByRole('option', { name: /Create branch/ })
    ).toHaveCount(0);

    await page
      .getByRole('option', { name: /existing-work/ })
      .first()
      .click();
    await paletteInput(page).waitFor({ state: 'hidden' });

    // The checkout lands in the worktree's session menu, a modal that
    // hides the sidebar from role queries until it is gone.
    await dismissSessionMenu(page);
    await sidebarRow(page, /existing-work/).waitFor({
      state: 'visible',
      timeout: 30_000,
    });
    expect(
      existsSync(join(repoPath, '.claude', 'worktrees', 'existing-work'))
    ).toBe(true);
  });
});
