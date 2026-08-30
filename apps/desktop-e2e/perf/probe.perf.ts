import { expect, test } from '@playwright/test';
import { createBigRepo } from './setup/big-repo.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';

/**
 * Not a benchmark — a sanity check on the benchmarks.
 *
 * A diff benchmark that quietly measured an empty pane would report
 * beautiful numbers forever, and an earlier version of the diff
 * scenario did exactly that: `.tabular-nums` and `.overflow-auto` both
 * also match the sidebar, so it timed the sidebar rendering and
 * concluded the viewer opened in 120 ms. This opens the same fixture
 * and prints what is actually on screen. Run it whenever a result
 * looks too good.
 */
test('probe: what the diff benchmark is measuring', async () => {
  test.setTimeout(180_000);
  const repo = createBigRepo();
  const app = await launchApp({ repoPath: repo.path });
  try {
    await unthrottle(app.app);
    const page = app.page;
    await page
      .getByRole('button', { name: 'New worktree', exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    await page.getByText(repo.branch, { exact: false }).first().click();
    await page
      .locator('[data-diff-scroll] [data-row-kind="unified"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await pace(page, 3000);

    const shape = await page.evaluate(() => {
      const pane = document.querySelector('[data-diff-scroll]');
      const rows = Array.from(
        document.querySelectorAll(
          '[data-diff-scroll] [data-row-kind="unified"]'
        )
      );
      return {
        scrollHeight: pane?.scrollHeight ?? 0,
        clientHeight: pane?.clientHeight ?? 0,
        // Virtualization means this stays small however tall the diff
        // gets; a number that tracks the diff means it stopped working.
        totalNodes: document.querySelectorAll('*').length,
        codeRows: rows.length,
        colouredRows: rows.filter((r) => r.querySelector('span[style]')).length,
        longTaskSupported:
          PerformanceObserver.supportedEntryTypes.includes('longtask'),
      };
    });
    console.log('[probe]', JSON.stringify(shape, null, 2));

    expect(shape.codeRows).toBeGreaterThan(10);
    expect(shape.scrollHeight).toBeGreaterThan(shape.clientHeight * 10);
  } finally {
    await app.close();
    repo.cleanup();
  }
});
