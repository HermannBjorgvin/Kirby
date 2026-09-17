import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

// Use a silent fake-agent so there is no real agent activity — the only
// PTY output should come from the resize redraw.
test.use({
  n10Config: {
    aiCommand: fakeAgentCommand({ silent: true }),
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
  cols: 100,
  rows: 30,
});

test.describe('Resize does not trigger activity', () => {
  test('resizing a session does not enqueue it as idle-after-active', async ({
    n10,
  }) => {
    // 1. Create two sessions with silent agents (no real output).
    await createSession(n10.term, 'resized', { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    await createSession(n10.term, 'other', { start: true });
    await expect(n10.term.getByText(/Agent.*other/).first()).toBeVisible({
      timeout: 10_000,
    });
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // 2. Switch back to 'resized' and Tab into it.
    await n10.term.press('ArrowUp');
    await n10.term.press('Tab');

    // 3. Resize the terminal — this triggers PTY redraw output. Without
    //    the fix, this output would be counted as "activity" and after
    //    the idle window elapses, the watcher would fire the toast and
    //    enqueue 'resized' when we switch away.
    await n10.term.resize(80, 20);

    // 4. Quickly switch to 'other' (within the idle window).
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);
    await n10.term.press('ArrowDown');
    await n10.term.press('Tab');

    // 5. Wait longer than ACTIVITY_IDLE_MS (2s) + poll interval (250ms)
    //    to give the watcher time to detect a false active→idle edge.
    await settleFor(
      n10.term.page,
      3_000,
      'longer than the activity idle window, to prove no toast fires'
    );

    // 6. The toast "resized is idle" should NOT appear — the resize
    //    output was suppressed and never counted as activity.
    await expect(n10.term.getByText('resized is idle')).toBeHidden();

    // 7. Ctrl+Space from 'other' should NOT jump to 'resized' (queue
    //    should be empty) — it should just focus the sidebar.
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);
  });
});
