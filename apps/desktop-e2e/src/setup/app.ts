import type { Locator, Page } from '@playwright/test';

/**
 * Locators for the desktop shell, in one place.
 *
 * Several labels appear twice on purpose in the UI (the sidebar's
 * "New worktree" toolbar button and the empty state's button, for
 * one), so tests that build their own locators trip over strict mode.
 * These helpers scope each one to the region it belongs to.
 */

export function sidebar(page: Page): Locator {
  return page.locator('aside');
}

/** The sidebar toolbar's + button. */
export function newWorktreeButton(page: Page): Locator {
  return sidebar(page).getByLabel('New worktree');
}

/** The button inside the "no worktrees yet" empty state. */
export function emptyStateNewWorktree(page: Page): Locator {
  return sidebar(page).getByRole('button', { name: 'New worktree' }).last();
}

export function sidebarRow(page: Page, name: string | RegExp): Locator {
  return sidebar(page).getByRole('button', { name });
}

export function tab(page: Page, name: string | RegExp): Locator {
  return page.getByRole('tab', { name });
}

export function tabs(page: Page): Locator {
  return page.getByRole('tab');
}

/** The command palette's input, once open. */
export function paletteInput(page: Page): Locator {
  return page.getByPlaceholder('Branch name, pull request, or command…');
}

export async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+k');
  const input = paletteInput(page);
  await input.waitFor({ state: 'visible' });
  return input;
}

/**
 * Create `branch` as a new worktree through the command palette, and
 * wait for the sidebar to show it.
 *
 * The palette filters as you type and the "Create branch…" row only
 * appears once the query is a valid, unused branch name, so this waits
 * for that row rather than blind-pressing Enter.
 */
export async function createWorktree(
  page: Page,
  branch: string
): Promise<void> {
  const input = await openPalette(page);
  await input.fill(branch);
  const createRow = page.getByRole('option', {
    name: new RegExp(`Create branch\\s*${branch}\\s*and open a worktree`),
  });
  await createRow.waitFor({ state: 'visible' });
  await createRow.click();
  await paletteInput(page).waitFor({ state: 'hidden' });
  await sidebarRow(page, new RegExp(branch)).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}
