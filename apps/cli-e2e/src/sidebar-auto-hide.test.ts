import { test, expect } from './fixtures/kirby.js';

test.use({
  kirbyConfig: {
    aiCommand: 'echo kirby-session-active && sleep 300',
    keybindPreset: 'vim',
  },
});

test.describe('Sidebar auto-hide', () => {
  test('hides on Tab into a session and reappears on Tab out', async ({
    kirby,
  }) => {
    const branchName = 'autohide-e2e';

    // 1. Empty state
    await expect(kirby.term.getByText('(no sessions)')).toBeVisible();

    // 2. Create a session via the branch picker
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
    await kirby.term.type(branchName);
    await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });
    // Let React re-render so useInput closure captures the updated filter.
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    // 3. Session is visible in the sidebar
    await expect(kirby.term.getByText('Branch Picker')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText(branchName).first()).toBeVisible({
      timeout: 10_000,
    });

    // 4. Tab → PTY starts, focus moves to terminal, sidebar hides.
    //    The session name may still be visible as the main pane title, so
    //    assert on a sidebar-only element (keybind hint "quit") instead.
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-session-active').first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(kirby.term.getByText('quit').first()).not.toBeVisible({
      timeout: 5_000,
    });

    // 5. Ctrl+Space exits the terminal pane → sidebar reappears.
    //    (Tab is forwarded into the PTY when focused on the agent, so the
    //    exit key is \x00 — see useRawStdinForward.ts.)
    await kirby.term.write('\x00');
    await expect(kirby.term.getByText('quit').first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
