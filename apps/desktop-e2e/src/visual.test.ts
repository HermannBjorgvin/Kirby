import { test, expect } from './fixtures/desktop.js';
import { createWorktree, openPalette, sidebarRow, tab } from './setup/app.js';
import { armContextMenuChoice, clickAppMenuItem } from './setup/menu.js';

/**
 * Screenshot comparisons, kept to the surfaces where they earn their
 * keep: dialogs and full-window layout. One image catches a whole class
 * of things assertions do not — a dialog that renders off-centre or
 * behind its overlay, a pane that collapsed to zero height, a control
 * that lost its label, a theme that half-applied.
 *
 * Kept honest about their limits:
 *   • The repo name is fixed (`kirby-visual`) rather than a random
 *     tempdir, or every run would differ.
 *   • Animations are disabled and the caret hidden, so a capture cannot
 *     land mid-transition.
 *   • The terminal is never in shot — it renders agent output and a
 *     blinking cursor.
 *   • A small pixel-ratio tolerance absorbs font antialiasing between
 *     machines while still failing on anything that moved.
 *
 * These run only inside the pinned container (`nx e2e:visual
 * desktop-e2e`), which is the whole point: fonts differ between this
 * machine, another developer's and the CI runner, and a pixel-ratio
 * tolerance is far stricter on a small dialog than on a full window.
 * The default `e2e` target skips them.
 *
 * A diff here means "look at it", not "something is broken": regenerate
 * with `node run-visual.mjs --update-snapshots` once you have.
 */

// Zero tolerance. Everything renders in one pinned container, so there
// is no cross-machine antialiasing to absorb — any differing pixel is a
// real change, and a tolerance would only hide small ones.
const shot = {
  animations: 'disabled',
  caret: 'hide',
  maxDiffPixels: 0,
} as const;

test.describe('Visual @visual', () => {
  test.use({ repo: { name: 'kirby-visual' } });

  test('empty workspace', async ({ desktop }) => {
    const { page } = desktop;
    await expect(
      page.getByText('No worktrees or pull requests yet.')
    ).toBeVisible();
    await expect(page).toHaveScreenshot('workspace-empty.png', shot);
  });

  test('command palette', async ({ desktop }) => {
    const { page } = desktop;
    await openPalette(page);
    await expect(page.getByText('Open settings')).toBeVisible();
    await expect(page).toHaveScreenshot('command-palette.png', shot);
  });

  test('settings page', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Settings…');
    await expect(tab(page, /Settings/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Appearance' })
    ).toBeVisible();
    await expect(page).toHaveScreenshot('settings.png', shot);
  });

  test('remove worktree dialog', async ({ desktop }) => {
    const { page, app } = desktop;
    await createWorktree(page, 'visual-branch');

    await armContextMenuChoice(app, 'Remove worktree…');
    await sidebarRow(page, /visual-branch/).click({ button: 'right' });

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Remove worktree?')).toBeVisible();
    // Wait for the safety check to answer, or the dialog is caught
    // mid-flight with its warning still missing.
    await expect(
      dialog.getByRole('button', { name: /^(Remove|Force remove)$/ })
    ).toBeVisible();
    await expect(dialog).toHaveScreenshot('dialog-remove-worktree.png', shot);
  });

  test('keyboard shortcuts dialog', async ({ desktop }) => {
    const { page } = desktop;
    await clickAppMenuItem(desktop.app, 'Keyboard Shortcuts');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot('dialog-shortcuts.png', shot);
  });
});

test.describe('Visual (diff) @visual', () => {
  test.use({
    repo: {
      name: 'kirby-visual',
      worktrees: [
        {
          branch: 'diffable',
          files: { 'greeting.txt': 'hello from the worktree\nsecond line\n' },
        },
      ],
    },
  });

  test('diff viewer', async ({ desktop }) => {
    const { page } = desktop;
    await sidebarRow(page, /diffable/).click();
    await expect(page.getByText('1 file changed')).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByText('hello from the worktree').first()
    ).toBeVisible();
    await expect(page).toHaveScreenshot('diff-viewer.png', shot);
  });
});

test.describe('Visual (light theme) @visual', () => {
  test.use({
    repo: { name: 'kirby-visual' },
    desktopPrefs: { theme: 'light', nativeFrame: false },
  });

  test('empty workspace in light theme', async ({ desktop }) => {
    const { page } = desktop;
    await expect(
      page.getByText('No worktrees or pull requests yet.')
    ).toBeVisible();
    // The palette that only the light theme uses is easy to half-apply;
    // one image covers every token at once.
    await expect(page).toHaveScreenshot('workspace-empty-light.png', shot);
  });
});
