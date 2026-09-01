import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import {
  createSession,
  waitForSidebarFocused,
  waitForTerminalFocused,
} from './setup/sessions.js';

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
    await createSession(kirby.term, branch, { start: true });

    // Wait for the banner so we know the PTY is up.
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
    await waitForTerminalFocused(kirby.term);
    await kirby.term.type('x');

    // Escape back to the sidebar; the row should flip. Selected +
    // stopped → ◎
    //
    // Retried rather than given a longer timeout. Nothing here waits for
    // the keystroke to have reached the PTY, for the agent to have died,
    // or for the registry to have noticed, so the escape can land while
    // the row is still legitimately ◉ — and a repaint of the sidebar is
    // what shows the new state. Re-escaping drives that repaint instead
    // of waiting for one. On CI, which runs this about half again as
    // slow as a local machine, a fixed 8s wait was losing the race.
    const stoppedRow = kirby.term.page.locator('.term-row', {
      hasText: new RegExp(`◎.*${branch}`),
    });
    await expect(async () => {
      await kirby.term.write('\x00');
      await waitForSidebarFocused(kirby.term);
      await expect(stoppedRow).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  });
});
