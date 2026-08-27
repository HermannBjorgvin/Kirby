import { basename } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { emptyStateNewWorktree, newWorktreeButton } from './setup/app.js';

test.describe('Startup', () => {
  test('opens the repo from KIRBY_START_DIR and shows its empty state', async ({
    desktop,
  }) => {
    const { page, repoPath } = desktop;

    // The window title bar and the sidebar header both name the repo.
    await expect(
      page.getByText(basename(repoPath), { exact: true }).first()
    ).toBeVisible();

    // A fresh repo has no worktrees and no provider configured.
    await expect(
      page.getByText('No worktrees or pull requests yet.')
    ).toBeVisible();
    await expect(emptyStateNewWorktree(page)).toBeVisible();
    await expect(newWorktreeButton(page)).toBeVisible();
  });

  test('reports the app version over the bridge', async ({ desktop }) => {
    const version = await desktop.page.evaluate(() =>
      window.kirby.getVersion()
    );
    // Set by the fixture; proves the preload bridge is attached and the
    // main process answered a real IPC call.
    expect(version.app).toBe('e2e');
    expect(version.electron).toMatch(/^\d+\./);
  });

  test('the renderer is sandboxed — no Node globals leak into the page', async ({
    desktop,
  }) => {
    const exposure = await desktop.page.evaluate(() => ({
      hasRequire: typeof (globalThis as Record<string, unknown>).require,
      hasProcess: typeof (globalThis as Record<string, unknown>).process,
      hasKirby: typeof window.kirby,
    }));
    expect(exposure.hasRequire).toBe('undefined');
    expect(exposure.hasProcess).toBe('undefined');
    expect(exposure.hasKirby).toBe('object');
  });
});
