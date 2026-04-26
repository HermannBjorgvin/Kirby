import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession } from './setup/sessions.js';

// `autoHideSidebar: false` keeps the sidebar visible while the terminal
// is focused, so we can assert against a row that isn't currently
// selected. Selected rows suppress the spinner by design (the user can
// see the activity live in the terminal pane).
test.use({
  kirbyConfig: {
    aiCommand: fakeAgentCommand({ bursts: 1, burstMs: 12_000 }),
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
});

const SPINNER_GLYPH_CLASS = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/;

test.describe('Activity spinner', () => {
  test('appears in sidebar row of a non-selected, bursting session', async ({
    kirby,
  }) => {
    // 1. Create session A (the busy one). PTY is not yet started.
    await createSession(kirby.term, 'busy');
    // 2. Tab into A → PTY spawns, fake-agent begins its burst.
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    // 3. Ctrl+Space escapes back to the sidebar.
    await kirby.term.write('\x00');

    // 4. Create session B (silent). Selection moves to B; A is no longer
    //    selected, so the activity indicator on A is now eligible to
    //    render.
    await createSession(kirby.term, 'idle');

    // 5. A is still bursting (12s headroom). Assert its row picks up a
    //    spinner glyph. The watcher polls at 250ms; allow generous slack
    //    so a slow CI runner doesn't flake.
    const busyRow = kirby.term.page.locator('.term-row', {
      hasText: /[●○].*busy/,
    });
    await expect(busyRow).toContainText(SPINNER_GLYPH_CLASS, {
      timeout: 8_000,
    });
  });
});
