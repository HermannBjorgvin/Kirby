import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from './fixtures/desktop.js';
import { createWorktree, tab } from './setup/app.js';
import { clickAppMenuItem } from './setup/menu.js';
import {
  UNSET_BACKEND,
  kirbySessionExists,
  kirbySessions,
  killKirbySessions,
  tmuxAvailable,
} from './setup/tmux.js';

/**
 * The backend nobody chose, through the built app.
 *
 * The host's resolution has unit tests; what only this file can show is
 * that the desktop actually reaches it — that the startup probe lands
 * before the repo opens and wires the session registry, rather than
 * racing it and stranding a tmux machine on PTY for the whole run.
 *
 * Skipped without tmux, where "the default is tmux" is not a claim
 * anything can make. CI installs it.
 */
test.skip(!tmuxAvailable(), 'tmux is not installed');

const BRANCH = 'tmux-default';

async function launchAgent(page: Page): Promise<void> {
  await page.getByRole('button', { name: /(Re)?launch agent/i }).click();
  await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
    timeout: 30_000,
  });
}

async function openSettings(app: ElectronApplication, page: Page) {
  await clickAppMenuItem(app, 'Settings…');
  await expect(tab(page, /Settings/)).toBeVisible();
}

test.describe('Terminal backend default (tmux detected)', () => {
  test.use({ kirbyConfig: UNSET_BACKEND });

  // Closing the app detaches rather than kills, by design.
  test.afterEach(({ desktop }) => {
    killKirbySessions(desktop.homeDir);
  });

  test('an unconfigured app runs its agents under tmux', async ({
    desktop,
  }) => {
    const { page, homeDir } = desktop;
    await createWorktree(page, BRANCH);
    await launchAgent(page);

    await expect
      .poll(() => kirbySessionExists(BRANCH, homeDir), {
        timeout: 15_000,
        intervals: [250],
      })
      .toBe(true);
  });

  test('Settings names tmux as the default rather than a stored value', async ({
    desktop,
  }) => {
    const { app, page } = desktop;
    await openSettings(app, page);

    // "(default)" is the part that matters: the row has to say the
    // backend was decided from the probe, not chosen by the user.
    await expect(
      page.getByLabel('Terminal Backend', { exact: true })
    ).toHaveText(/Tmux \(default\)/);
  });
});

test.describe('Terminal backend explicitly set to pty', () => {
  test.use({ kirbyConfig: { terminalBackend: 'pty' } });

  test('a stored "pty" survives tmux being installed', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    await createWorktree(page, BRANCH);
    // The agent is genuinely running, so the absence of a tmux session
    // below means "not through tmux" rather than "not yet".
    await launchAgent(page);

    expect(kirbySessions(homeDir)).toEqual([]);
  });
});
