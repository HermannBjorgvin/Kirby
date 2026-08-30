import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { newWorktreeButton } from './setup/app.js';

/**
 * The repo gate is what a first launch lands on, and the only screen
 * that can fail on user input (a path that is not a repository). It has
 * a folder picker, but that is a native dialog — the path field is the
 * part a test can drive, and it reaches the same `openRepo`.
 */

test.describe('Repo picker', () => {
  test.use({
    startWithoutRepo: true,
    repo: { worktrees: [{ branch: 'inner' }] },
  });

  test('starts on the picker when there is no repo to open', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await expect(
      page.getByRole('button', { name: /Open repository/ })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText('Worktrees, agents and reviews for one repository.')
    ).toBeVisible();
    // Not the workspace.
    await expect(newWorktreeButton(page)).toHaveCount(0);
  });

  test('opening a path switches to the workspace for that repo', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    await page.getByPlaceholder('/path/to/repository').fill(repoPath);
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    await expect(newWorktreeButton(page)).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: repoPath,
    });
  });

  test('a path that is not a repository is refused, and the picker stays', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const notARepo = mkdtempSync(join(tmpdir(), 'kirby-not-a-repo-'));
    try {
      await page.getByPlaceholder('/path/to/repository').fill(notARepo);
      await page.getByRole('button', { name: 'Open', exact: true }).click();

      await expect(page.getByText(/Not a git repository/)).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Open repository/ })
      ).toBeVisible();
      expect(await page.evaluate(() => window.kirby.getRepo())).toBeNull();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  test('opens a git worktree, whose .git is a file not a directory', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    // Kirby's own worktrees look like this, and so does any submodule:
    // `.git` is a file pointing at the real git dir. Refusing them
    // would refuse the very thing the app is about.
    const worktree = join(repoPath, '.claude', 'worktrees', 'inner');
    await page.getByPlaceholder('/path/to/repository').fill(worktree);
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    await expect(newWorktreeButton(page)).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => window.kirby.getRepo())).toMatchObject({
      cwd: worktree,
    });
  });

  test('the Open button stays disabled until a path is typed', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const open = page.getByRole('button', { name: 'Open', exact: true });
    await expect(open).toBeDisabled();

    await page.getByPlaceholder('/path/to/repository').fill('   ');
    // Whitespace is not a path.
    await expect(open).toBeDisabled();

    await page.getByPlaceholder('/path/to/repository').fill('/somewhere');
    await expect(open).toBeEnabled();
  });
});

test.describe('Recent repositories', () => {
  test('the repo opened at startup is recorded as recent', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;
    // Recents are what a second launch restores from, so the entry has
    // to exist before the app is closed, not be written on exit.
    const recents = await page.evaluate(() => window.kirby.listRecentRepos());
    expect(recents.map((r) => r.cwd)).toContain(repoPath);
    expect(recents.find((r) => r.cwd === repoPath)?.valid).toBe(true);
  });
});
