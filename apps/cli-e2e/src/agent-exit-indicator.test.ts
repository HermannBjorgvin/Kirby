import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Regression for issue #55: when an agent terminated on its own
// (Ctrl-D Ctrl-D in claude, the process being killed, etc.), the
// sidebar row stayed green because the PTY registry never removed the
// dead entry — `hasSession` kept returning true so `session.running`
// stayed true.
test.use({
  kirbyConfig: {
    // Print banner, sit silent for ~2s, then exit. Mirrors an agent
    // that quit on its own without ever bursting again.
    aiCommand: fakeAgentCommand({ silent: true, exitAfterMs: 2_000 }),
    keybindPreset: 'vim',
  },
});

test.describe('Sidebar indicator after agent exit (#55)', () => {
  test('flips from running (◉) to stopped (◎) when the agent terminates', async ({
    kirby,
  }) => {
    const branch = 'short-lived';
    await createSession(kirby.term, branch);

    // Tab → start agent. Wait for banner so we know the PTY is up.
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });

    // Escape to sidebar so the row icon is visible.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // Selected + running → ◉
    const runningRow = kirby.term.page.locator('.term-row', {
      hasText: new RegExp(`◉.*${branch}`),
    });
    await expect(runningRow).toBeVisible({ timeout: 5_000 });

    // After the agent exits the indicator should flip. Selected + stopped → ◎
    const stoppedRow = kirby.term.page.locator('.term-row', {
      hasText: new RegExp(`◎.*${branch}`),
    });
    await expect(stoppedRow).toBeVisible({ timeout: 8_000 });
  });
});
