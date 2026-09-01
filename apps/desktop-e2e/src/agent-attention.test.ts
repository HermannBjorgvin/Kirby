import { test, expect, fakeAgent } from './fixtures/desktop.js';
import { createWorktree, launchAgentFromRail, tab } from './setup/app.js';

/**
 * How you find out an agent finished while you were looking elsewhere.
 *
 * A session that worked for a while and then went quiet, whose output
 * you have not looked at, marks its tab for attention. The rule has
 * three parts that only make sense together — a long enough work
 * streak, then idle, and unseen output — so it is easy to get subtly
 * wrong in a way that either never fires or never stops firing. Both
 * failures are quiet, which is why this is worth an end-to-end test
 * rather than only the unit tests over the activity registry.
 *
 * Timings come from ACTIVITY_IDLE_MS (2s) and MIN_ACTIVE_MS (3s) in
 * app-core; the agent streams comfortably past the latter.
 */

test.describe('An agent that finishes while you are elsewhere', () => {
  test.use({
    kirbyConfig: {
      aiCommand: fakeAgent({ stream: true, intervalMs: 120, streamMs: 6000 }),
    },
  });

  test('marks its tab, and clears once you look at it', async ({ desktop }) => {
    const { page } = desktop;

    await createWorktree(page, 'worker');
    await launchAgentFromRail(page);
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });

    // Look away: while its terminal is on screen the session is marked
    // seen continuously, so it could never be flagged.
    await createWorktree(page, 'elsewhere');
    await expect(tab(page, /elsewhere/)).toBeVisible();

    // The agent keeps working, then stops. Once it has been quiet for
    // the idle window, the tab we are not looking at asks for us.
    // The mark is a class on the tab itself, not a badge inside it.
    await expect(tab(page, /worker/)).toHaveClass(/tab-attention/, {
      timeout: 30_000,
    });

    // Looking at it is what clears it.
    await tab(page, /worker/).click();
    await expect(tab(page, /worker/)).not.toHaveClass(/tab-attention/, {
      timeout: 20_000,
    });
  });
});

test.describe('An agent still working', () => {
  test.use({
    kirbyConfig: { aiCommand: fakeAgent({ stream: true, intervalMs: 120 }) },
  });

  test('shows as busy rather than asking for attention', async ({
    desktop,
  }) => {
    const { page } = desktop;

    await createWorktree(page, 'busy');
    await launchAgentFromRail(page);
    await expect(page.getByText('kirby-fake-agent-ready').first()).toBeVisible({
      timeout: 30_000,
    });

    await createWorktree(page, 'elsewhere');

    // Busy and finished are different states and must look different:
    // a spinner while it works, the attention mark only once it stops.
    const busyTab = tab(page, /busy/);
    await expect(busyTab.locator('.agent-spinner')).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(busyTab).not.toHaveClass(/tab-attention/);
  });
});
