import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { wtermHost } from './setup/constants.js';
import {
  createSession,
  pressUntil,
  waitForSidebarFocused,
} from './setup/sessions.js';

// Regression for issue #56: pressing 'q' did not quit n10 while an
// agent PTY was still running, because Ink's exit() only unmounts the
// React tree — the live node-pty children kept the event loop alive.
//
// We assert that n10's PTY is gone after 'q' by polling the wterm
// host's `/status` endpoint, which reports whether `activePty` (the
// n10 process) is still attached.
test.use({
  n10Config: {
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
  test("'q' exits n10 cleanly even while an agent PTY is running", async ({
    n10,
    baseURL,
  }) => {
    const host = wtermHost(baseURL);

    await createSession(n10.term, 'busy-q', { start: true });

    // Wait for the agent's banner so we know the PTY is up and bursting
    // before we try to quit.
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });

    // Escape back to the sidebar so 'q' is interpreted as sidebar.quit.
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // Sanity: n10 is still up.
    expect((await fetchStatus(host)).ptyAlive).toBe(true);

    // The fix under test: this should actually exit n10.
    //
    // `pressUntil` rather than a longer poll. Two things can fail here and
    // a bigger timeout only covers one: `handleExit` races
    // settlePendingRuns() against EXIT_GRACE_MS (3s) before process.exit
    // (slow, so waiting helps), and the 'q' can be dropped outright after
    // the preceding Ctrl+Space (waiting never helps).
    //
    // Re-pressing is safe: 'q' is idempotent in the sidebar, and once
    // n10 is tearing down the keystroke is a no-op — the client only
    // sends on an OPEN socket and the host ignores input with no PTY.
    await pressUntil(
      n10.term,
      'q',
      async () => !(await fetchStatus(host)).ptyAlive
    );
  });
});
