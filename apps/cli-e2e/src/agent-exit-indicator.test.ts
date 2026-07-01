import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Regression for issue #55: when an agent terminated on its own
// (Ctrl-D Ctrl-D in claude, the process being killed, etc.), the
// sidebar row stayed green because the PTY registry never removed the
// dead entry — `hasSession` kept returning true so `session.running`
// stayed true.
test.use({
  kirbyConfig: {
    // Print banner, sit silent, then exit on the first keystroke it
    // receives. Mirrors an agent that quits on its own — but the test
    // controls *when*, so it can confirm the running state first without
    // racing a wall-clock timer.
    aiCommand: fakeAgentCommand({ silent: true, exitOnInput: true }),
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

    // Escape to sidebar so the row icon is visible. Agent is still alive
    // (it only exits on input), so this is a stable ◉.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // Selected + running → ◉
    const runningRow = kirby.term.page.locator('.term-row', {
      hasText: new RegExp(`◉.*${branch}`),
    });
    await expect(runningRow).toBeVisible({ timeout: 5_000 });

    // Tab back into the terminal and send a keystroke — the agent exits
    // on input, deterministically, only now that ◉ is confirmed.
    await kirby.term.press('Tab');
    await kirby.term.type('x');

    // Escape back to the sidebar; the row should flip. Selected +
    // stopped → ◎
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);
    const stoppedRow = kirby.term.page.locator('.term-row', {
      hasText: new RegExp(`◎.*${branch}`),
    });
    await expect(stoppedRow).toBeVisible({ timeout: 8_000 });
  });
});
