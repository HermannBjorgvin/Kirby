import { test, expect } from './fixtures/n10.js';
import { startFromSessionMenu } from './setup/sessions.js';
import { settleFor } from './setup/waits.js';

test.use({
  n10Config: {
    aiCommand: 'echo n10-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Sidebar auto-hide', () => {
  test('hides on Tab into a session and reappears on Tab out', async ({
    n10,
  }) => {
    const branchName = 'autohide-e2e';

    // 1. Empty state
    await expect(n10.term.getByText('(no sessions)')).toBeVisible();

    // 2. Create a session via the branch picker
    await n10.term.type('c');
    await expect(n10.term.getByText('Branch Picker')).toBeVisible();
    await n10.term.type(branchName);
    await expect(n10.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });
    // Let React re-render so useInput closure captures the updated filter.
    await settleFor(
      n10.term.page,
      2_000,
      "Ink's useInput captured the old filter until the next render"
    );
    await n10.term.press('Enter');

    // 3. Session is visible in the sidebar
    await expect(n10.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(n10.term.getByText(branchName).first()).toBeVisible({
      timeout: 10_000,
    });

    // 4. Enter in the session menu → PTY starts, focus moves to the
    //    terminal, sidebar hides. The session name may still be visible
    //    as the main pane title, so assert on a sidebar-only element
    //    (keybind hint "quit") instead.
    await startFromSessionMenu(n10.term);
    await expect(n10.term.getByText('n10-session-active').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(n10.term.getByText('quit').first()).not.toBeVisible({
      timeout: 5_000,
    });

    // 5. Ctrl+Space exits the terminal pane → sidebar reappears.
    //    (Tab is forwarded into the PTY when focused on the agent, so the
    //    exit key is \x00 — see useRawStdinForward.ts.)
    await n10.term.write('\x00');
    await expect(n10.term.getByText('quit').first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
