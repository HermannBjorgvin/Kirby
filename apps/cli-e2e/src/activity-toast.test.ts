import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { createSession, waitForSidebarFocused } from './setup/sessions.js';

test.use({
  n10Config: {
    // 4s of bursts comfortably exceeds MIN_ACTIVE_MS=300, so the
    // session becomes flash-eligible. After the burst ends, the watcher
    // detects the active→idle transition (~ACTIVITY_IDLE_MS=2s later)
    // and fires the info toast.
    aiCommand: fakeAgentCommand({ bursts: 1, burstMs: 4_000 }),
    autoHideSidebar: false,
    keybindPreset: 'vim',
  },
});

test.describe('Activity toast', () => {
  test('idle toast fires for a non-viewed session that goes idle', async ({
    n10,
  }) => {
    // 1. Create the session that will burst then go idle ("busy"), and
    //    Tab into it so the PTY actually starts.
    await createSession(n10.term, 'busy', { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await n10.term.write('\x00');
    await waitForSidebarFocused(n10.term);

    // 2. Create a second session ("idle") so busy is no longer the
    //    currently-viewed session — that suppression rule is what we're
    //    explicitly side-stepping here.
    await createSession(n10.term, 'idle');

    // 3. Wait for busy's burst to end and the watcher to detect the
    //    active→idle edge. Toast text comes from
    //    `${name} is idle` in useInactiveAlertWatcher.ts.
    await expect(n10.term.getByText('busy is idle')).toBeVisible({
      timeout: 10_000,
    });
  });
});
