import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Use a silent fake-agent so there is no real agent activity — the only
// PTY output should come from the resize redraw.
test.use({
  kirbyConfig: {
    aiCommand: fakeAgentCommand({ silent: true }),
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
  cols: 100,
  rows: 30,
});

test.describe('Resize does not trigger activity', () => {
  test('resizing a session does not enqueue it as idle-after-active', async ({
    kirby,
  }) => {
    // 1. Create two sessions with silent agents (no real output).
    await createSession(kirby.term, 'resized');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    await createSession(kirby.term, 'other');
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*other/).first()).toBeVisible({
      timeout: 10_000,
    });
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // 2. Switch back to 'resized' and Tab into it.
    await kirby.term.press('ArrowUp');
    await kirby.term.press('Tab');

    // 3. Resize the terminal — this triggers PTY redraw output. Without
    //    the fix, this output would be counted as "activity" and after
    //    the idle window elapses, the watcher would fire the toast and
    //    enqueue 'resized' when we switch away.
    await kirby.term.resize(80, 20);

    // 4. Quickly switch to 'other' (within the idle window).
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);
    await kirby.term.press('ArrowDown');
    await kirby.term.press('Tab');

    // 5. Wait longer than ACTIVITY_IDLE_MS (2s) + poll interval (250ms)
    //    to give the watcher time to detect a false active→idle edge.
    await kirby.term.page.waitForTimeout(3_000);

    // 6. The toast "resized is idle" should NOT appear — the resize
    //    output was suppressed and never counted as activity.
    await expect(kirby.term.getByText('resized is idle')).not.toBeVisible();

    // 7. Ctrl+Space from 'other' should NOT jump to 'resized' (queue
    //    should be empty) — it should just focus the sidebar.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);
  });
});
