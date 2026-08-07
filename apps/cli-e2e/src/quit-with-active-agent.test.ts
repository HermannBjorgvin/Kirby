import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

// Regression for issue #56: pressing 'q' did not quit Kirby while an
// agent PTY was still running, because Ink's exit() only unmounts the
// React tree — the live node-pty children kept the event loop alive.
//
// We assert that Kirby's PTY is gone after 'q' by polling the wterm
// host's `/status` endpoint, which reports whether `activePty` (the
// Kirby process) is still attached.
test.use({
  kirbyConfig: {
    aiCommand: fakeAgentCommand({
      bursts: 'inf',
      burstMs: 500,
      idleMs: 200,
    }),
    keybindPreset: 'vim',
  },
});

interface Status {
  ptyAlive: boolean;
}

async function fetchStatus(baseURL: string): Promise<Status> {
  const r = await fetch(`${baseURL}/status`);
  return (await r.json()) as Status;
}

test.describe('Quit with active agent (#56)', () => {
  test("'q' exits Kirby cleanly even while an agent PTY is running", async ({
    kirby,
    baseURL,
  }) => {
    const host = baseURL ?? 'http://localhost:5174';

    await createSession(kirby.term, 'busy-q');

    // Tab → spawn the agent. Wait for its banner so we know the PTY is
    // up and bursting before we try to quit.
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });

    // Escape back to the sidebar so 'q' is interpreted as sidebar.quit.
    await kirby.term.write('\x00');
    await waitForSidebarFocused(kirby.term);

    // Sanity: Kirby is still up.
    expect((await fetchStatus(host)).ptyAlive).toBe(true);

    // The fix under test: this should actually exit Kirby.
    //
    // Retry the keypress rather than only waiting longer. Two things can
    // go wrong here and a bigger timeout addresses just one of them:
    //
    //  1. Slow exit — `handleExit` races settlePendingRuns() against
    //     EXIT_GRACE_MS (3s) before process.exit, so teardown can take a
    //     few seconds under load.
    //  2. Lost keystroke — a key can be swallowed when it lands in the
    //     same stdin chunk as the preceding Ctrl+Space: the escape fires
    //     but Ink's sidebar useInput isn't active yet in that React tick,
    //     so the key is dispatched against the terminal context and
    //     dropped. `createSession` already retries around exactly this.
    //     No timeout recovers a key that was never delivered.
    //
    // Re-pressing is safe: 'q' is idempotent in the sidebar, and once
    // Kirby is tearing down the keystroke is a no-op (the client only
    // sends on an OPEN socket, and the host ignores input with no PTY).
    await expect(async () => {
      await kirby.term.press('q');
      expect((await fetchStatus(host)).ptyAlive).toBe(false);
    }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
  });
});
