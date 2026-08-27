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

/**
 * The spinner the tab strip and sidebar show while an agent is
 * actively producing output.
 *
 * This is the same signal `useCloseTabs` reads to decide whether to
 * confirm, so waiting on it is what makes those tests deterministic:
 * host-side activity is polled once a second, and a session counts as
 * active for ACTIVITY_IDLE_MS (2s) after its last byte — including the
 * banner an "idle" agent prints on startup.
 */
export function agentSpinner(page: Page): Locator {
  return page.locator('.agent-spinner');
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
 * Open a worktree for `branch` through the command palette, and wait
 * for the sidebar to show it.
 *
 * The palette offers two different rows depending on the branch: a
 * "Create branch…" row for a name git doesn't know yet, and a plain
 * checkout row under "Check out branch" for one that already exists.
 * Both end in the same worktree, so this takes whichever is on offer.
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
  const checkoutRow = page
    .getByRole('option', { name: new RegExp(`^${branch}$`) })
    .first();
  await createRow
    .or(checkoutRow)
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 });
  await ((await createRow.count()) > 0 ? createRow : checkoutRow).click();

  await paletteInput(page).waitFor({ state: 'hidden' });
  await sidebarRow(page, new RegExp(branch)).waitFor({
    state: 'visible',
    timeout: 30_000,
  });
}
