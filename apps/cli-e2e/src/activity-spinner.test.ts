import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// `autoHideSidebar: false` keeps the sidebar visible while the terminal
// is focused, so we can assert against a row that isn't currently
// selected. Selected rows suppress the spinner by design (the user can
// see the activity live in the terminal pane).
test.use({
  n10Config: {
    aiCommand: fakeAgentCommand({ bursts: 1, burstMs: 12_000 }),
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
});

const SPINNER_GLYPH_CLASS = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

test.describe('Activity spinner', () => {
  test('appears in sidebar row of a non-selected, bursting session', async ({
    n10,
  }) => {
    // 1. Create session A (the busy one). PTY is not yet started.
    await createSession(n10.term, 'busy', { start: true });
    // 2. Started from the session menu → PTY spawns, fake-agent bursts.
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    // 3. Ctrl+Space escapes back to the sidebar. Wait for the focus
    //    change to actually land before continuing — see
    //    waitForSidebarFocused for why.
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // 4. Create session B (silent). Selection moves to B; A is no longer
    //    selected, so the activity indicator on A is now eligible to
    //    render.
    await createSession(n10.term, 'idle');

    // 5. A is still bursting (12s headroom). Assert its row picks up a
    //    spinner glyph. The watcher polls at 250ms; allow generous slack
    //    so a slow CI runner doesn't flake.
    const busyRow = n10.term.page.locator('.term-row', {
      hasText: /[●○].*busy/,
    });
    await expect(busyRow).toContainText(SPINNER_GLYPH_CLASS, {
      timeout: 8_000,
    });
  });
});
