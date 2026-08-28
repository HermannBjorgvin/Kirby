import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import {
  createWorktree,
  openPalette,
  paletteInput,
  sidebar,
  tab,
  tabs,
} from './setup/app.js';

/**
 * The palette is the desktop's keyboard surface: jump to a worktree,
 * check out a branch, or run an app command. Ctrl+K is a renderer
 * keybinding (unlike Ctrl+, which is a native menu accelerator), so it
 * is reachable from a synthesized key event.
 */

function storedPrefs(homeDir: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(homeDir, '.kirby', 'desktop-prefs.json'), 'utf8')
  ) as Record<string, unknown>;
}

test.describe('Command palette', () => {
  test('Ctrl+K opens it and Escape closes it', async ({ desktop }) => {
    const { page } = desktop;
    await openPalette(page);
    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toBeHidden();
  });

  test('jumps to an existing worktree instead of checking it out again', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await createWorktree(page, 'jumpable');
    await expect(tabs(page)).toHaveCount(1);

    // Close the tab, then reopen it from the palette.
    await tab(page, /jumpable/)
      .getByLabel('Close tab')
      .click();
    await expect(tabs(page)).toHaveCount(0);

    const input = await openPalette(page);
    await input.fill('jumpable');
    // A branch that already has a worktree is offered as a jump, not as
    // a checkout — checking it out again would fail in git.
    await expect(
      page.getByRole('option', { name: /Create branch/ })
    ).toHaveCount(0);
    await page
      .getByRole('option', { name: /jumpable/ })
      .first()
      .click();

    await expect(tab(page, /jumpable/)).toBeVisible();
  });

  test('toggles the sidebar and remembers it', async ({ desktop }) => {
    const { page } = desktop;
    await expect(sidebar(page)).toBeVisible();

    const input = await openPalette(page);
    await input.fill('toggle sidebar');
    await page.getByRole('option', { name: /Toggle sidebar/ }).click();
    await expect(sidebar(page)).toBeHidden();

    // Persisted so the next launch opens the way it was left.
    expect(
      await page.evaluate(() => localStorage.getItem('kirby.sidebar.hidden'))
    ).toBe('1');

    const again = await openPalette(page);
    await again.fill('toggle sidebar');
    await page.getByRole('option', { name: /Toggle sidebar/ }).click();
    await expect(sidebar(page)).toBeVisible();
  });

  test('switches theme and persists it to the host, not just the page', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    const wasDark = await page.evaluate(() =>
      document.documentElement.classList.contains('dark')
    );

    const input = await openPalette(page);
    await input.fill('theme');
    await page
      .getByRole('option', { name: /Switch to (light|dark) theme/ })
      .click();

    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('dark'))
      )
      .toBe(!wasDark);

    // The host owns the persisted preference: the native menu's Theme
    // radio and the window chrome read it from there, so a page-only
    // toggle would leave the OS chrome on the old theme.
    await expect
      .poll(() => storedPrefs(homeDir).theme)
      .toBe(wasDark ? 'light' : 'dark');
  });

  test('offers settings as a command', async ({ desktop }) => {
    const { page } = desktop;
    const input = await openPalette(page);
    await input.fill('settings');
    await page.getByRole('option', { name: /Open settings/ }).click();
    await expect(tab(page, /Settings/)).toBeVisible();
  });

  test('says so when nothing matches', async ({ desktop }) => {
    const { page } = desktop;
    const input = await openPalette(page);
    await input.fill('zzz nothing matches this zzz');
    await expect(page.getByText('No matches.')).toBeVisible();
  });
});
