import { test, expect, fakeAgentCommand } from './fixtures/kirby.js';
import { createSession } from './setup/sessions.js';

test.use({
  kirbyConfig: {
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
    kirby,
  }) => {
    // 1. Create the session that will burst then go idle ("busy"), and
    //    Tab into it so the PTY actually starts.
    await createSession(kirby.term, 'busy');
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('kirby-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await kirby.term.write('\x00');

    // 2. Create a second session ("idle") so busy is no longer the
    //    currently-viewed session — that suppression rule is what we're
    //    explicitly side-stepping here.
    await createSession(kirby.term, 'idle');

    // 3. Wait for busy's burst to end and the watcher to detect the
    //    active→idle edge. Toast text comes from
    //    `${name} is idle` in useInactiveAlertWatcher.ts.
    await expect(kirby.term.getByText('busy is idle')).toBeVisible({
      timeout: 10_000,
    });
  });
});
