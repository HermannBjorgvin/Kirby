import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { sidebarLocator } from './setup/sidebar.js';
import { createSession } from './setup/sessions.js';

// Both sessions run the same fake-agent (aiCommand is global). We rely
// on the active→idle edge being detected after the 4s burst plus the
// 2s idle window, while we focus into the second session and let the
// first one transition behind us.
const aiCommand = fakeAgentCommand({ bursts: 1, burstMs: 4_000 });

test.describe('Activity queue (Ctrl+Space, setting on)', () => {
  test.use({
    kirbyConfig: {
      aiCommand,
      autoHideSidebar: false,
      keybindPreset: 'vim',
    },
  });

  test('jumps to a queued idle session', async ({ kirby }) => {
    // Session A: bursts then goes idle.
    await createSession(kirby.term, 'busy');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');

    // Session B: created next, focus moves here. We Tab into it so its
    // PTY starts (otherwise Ctrl+Space wouldn't intercept — escape only
    // works from a terminal-focused session).
    await createSession(kirby.term, 'second');
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*second/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the watcher to detect "busy" going idle and enqueue it.
    // The toast is the user-visible signal that the queue has an entry.
    await expect(kirby.term.getByText('busy is idle')).toBeVisible({
      timeout: 12_000,
    });

    // Ctrl+Space from inside `second`'s terminal should pop the queue
    // and select `busy` (instead of returning to the sidebar).
    await kirby.term.write('\x00');

    // Sidebar selection moved to `busy` (◉ ring icon in front of name).
    await expect(
      sidebarLocator(kirby.term.page, 'busy').selected()
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Activity queue (Ctrl+Space, setting off)', () => {
  test.use({
    kirbyConfig: {
      aiCommand,
      autoHideSidebar: false,
      jumpToInactiveOnEscape: false,
      keybindPreset: 'vim',
    },
  });

  test('falls back to sidebar focus when setting is off', async ({ kirby }) => {
    await createSession(kirby.term, 'busy');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');

    await createSession(kirby.term, 'second');
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(/Agent.*second/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Toast still fires (toast is independent of the jump setting), so
    // we can use it as a synchronization point that the model has
    // observed busy → idle.
    await expect(kirby.term.getByText('busy is idle')).toBeVisible({
      timeout: 12_000,
    });

    await kirby.term.write('\x00');

    // With the setting off, Ctrl+Space should restore the original
    // behavior: focus the sidebar. Focus signal we can observe is that
    // the main pane no longer carries the "(ctrl+space to exit)" hint,
    // which getPaneTitle only appends when terminal-focused.
    await expect(kirby.term.getByText(/ctrl\+space to exit/)).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
