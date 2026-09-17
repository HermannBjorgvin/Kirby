import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Both sessions run the same fake-agent (aiCommand is global). We rely
// on the active→idle edge being detected after the 4s burst plus the
// 2s idle window, while we focus into the second session and let the
// first one transition behind us.
const aiCommand = fakeAgentCommand({ bursts: 1, burstMs: 4_000 });

test.describe('Activity queue (Ctrl+Space, setting on)', () => {
  test.use({
    n10Config: {
      aiCommand,
      autoHideSidebar: false,
      keybindPreset: 'vim',
    },
  });

  test('jumps to a queued idle session', async ({ n10 }) => {
    // Session A: bursts then goes idle.
    await createSession(n10.term, 'busy', { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // Session B: created next, focus moves here. We Tab into it so its
    // PTY starts (otherwise Ctrl+Space wouldn't intercept — escape only
    // works from a terminal-focused session).
    await createSession(n10.term, 'second', { start: true });
    await expect(n10.term.getByText(/Agent.*second/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the watcher to detect "busy" going idle and enqueue it.
    // The toast is the user-visible signal that the queue has an entry.
    await expect(n10.term.getByText('busy is idle')).toBeVisible({
      timeout: 12_000,
    });

    // Ctrl+Space from inside `second`'s terminal should pop the queue
    // and select `busy` (instead of returning to the sidebar).
    await n10.term.write('\x00');

    // Sidebar selection moved to `busy` (◉ ring icon in front of name).
    await expect(sidebarLocator(n10.term.page, 'busy').selected()).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('Activity queue (Ctrl+Space, setting off)', () => {
  test.use({
    n10Config: {
      aiCommand,
      autoHideSidebar: false,
      jumpToInactiveOnEscape: false,
      keybindPreset: 'vim',
    },
  });

  test('falls back to sidebar focus when setting is off', async ({ n10 }) => {
    await createSession(n10.term, 'busy', { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    await createSession(n10.term, 'second', { start: true });
    await expect(n10.term.getByText(/Agent.*second/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Toast still fires (toast is independent of the jump setting), so
    // we can use it as a synchronization point that the model has
    // observed busy → idle.
    await expect(n10.term.getByText('busy is idle')).toBeVisible({
      timeout: 12_000,
    });

    await n10.term.write('\x00');

    // With the setting off, Ctrl+Space should restore the original
    // behavior: focus the sidebar. Focus signal we can observe is that
    // the main pane no longer carries the "(ctrl+space to exit)" hint,
    // which getPaneTitle only appends when terminal-focused.
    await expect(n10.term.getByText(/ctrl\+space to exit/)).not.toBeVisible({
      timeout: 5_000,
    });
  });
});
