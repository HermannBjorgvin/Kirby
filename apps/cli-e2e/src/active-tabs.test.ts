import { test, expect } from './fixtures/kirby.js';
import { sidebarLocator } from './setup/sidebar.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Quiet agents that just print a banner then sleep keep the PTYs alive
// without producing the bursty output the activity tests need —
// perfect for exercising input plumbing.
test.use({
  kirbyConfig: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
});

test.describe('Active-session tab bar', () => {
  test('Ctrl+Space + digit selects the Nth running tab and focuses terminal', async ({
    kirby,
  }) => {
    // 1. Create `alpha` and start its PTY.
    await createSession(kirby.term, 'alpha');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-session-active').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // 2. Create `beta` and start its PTY. Focus is now in beta's
    //    terminal; both sessions are running.
    await createSession(kirby.term, 'beta');
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*beta/).first()).toBeVisible({
      timeout: 10_000,
    });

    // 3. The tab bar above the agent terminal lists both running sessions
    //    in sidebar order (alpha → 1, beta → 2) since neither has a PR.
    await expect(kirby.term.getByText('1 alpha').first()).toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText('2 beta').first()).toBeVisible({
      timeout: 5_000,
    });

    // 4. Ctrl+Space focuses the sidebar; '1' jumps to alpha and lands
    //    focus straight back in the terminal.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);
    await kirby.term.type('1');

    // Selection moved to alpha (◉ ring icon in front of the row).
    await expect(
      sidebarLocator(kirby.term.page, 'alpha').selected()
    ).toBeVisible({ timeout: 5_000 });
    // Pane title's "(ctrl+space to exit)" hint only renders when the
    // terminal is focused — its presence proves the focus jump.
    await expect(kirby.term.getByText(/ctrl\+space to exit/)).toBeVisible({
      timeout: 5_000,
    });
  });
});
