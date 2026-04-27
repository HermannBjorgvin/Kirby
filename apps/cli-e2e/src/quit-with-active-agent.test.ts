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
    await kirby.term.press('q');

    await expect
      .poll(async () => (await fetchStatus(host)).ptyAlive, {
        timeout: 6_000,
        intervals: [150],
      })
      .toBe(false);
  });
});
