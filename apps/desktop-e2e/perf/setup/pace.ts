import type { Page } from '@playwright/test';

/**
 * The one place a benchmark waits by the clock.
 *
 * Everywhere else in this workspace a fixed wait is a bug, and the lint
 * rule says so. Here it is the measurement: a scroll benchmark has to
 * drive the app at a human cadence and see what the main thread does
 * between the steps. Replacing it with an auto-waiting assertion would
 * wait for the app to become idle — which is precisely the cost the
 * benchmark exists to catch, so the run would report zero and mean it.
 *
 * Nothing else in `perf/` may wait on a timer — the rule is turned off
 * for this file alone, in `eslint.config.mjs`, and stays on everywhere
 * else. (Scoped there rather than inline: the pre-commit hook runs
 * eslint without the Playwright plugin, where an inline directive
 * naming one of its rules is a hard error.)
 */
export async function pace(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}
