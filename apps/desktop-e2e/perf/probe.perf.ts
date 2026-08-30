import { expect, test } from '@playwright/test';
import { createBigRepo } from './setup/big-repo.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';

/**
 * Not a benchmark — a sanity check on the benchmarks.
 *
 * A scroll benchmark that quietly measured an empty pane would report
 * beautiful numbers forever. This one opens the same fixture the diff
 * benchmark uses and prints what is actually on screen: how tall the
 * virtualized list thinks it is, how many rows exist, whether the long
 * task observer sees anything at all. Run it whenever a result looks
 * too good.
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
      .locator('.tabular-nums')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });
    await pace(page, 3000);

    const shape = await page.evaluate(() => {
      const scrollers = [...document.querySelectorAll('*')]
        .filter((el) => el.scrollHeight > el.clientHeight + 200)
        .map((el) => ({
          cls: el.className.toString().slice(0, 70),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }));
      return {
        scrollers,
        totalNodes: document.querySelectorAll('*').length,
        gutterCells: document.querySelectorAll('.tabular-nums').length,
        colouredTokens: document.querySelectorAll('span[style*="color"]')
          .length,
        longTaskSupported:
          PerformanceObserver.supportedEntryTypes.includes('longtask'),
      };
    });
    console.log('[probe]', JSON.stringify(shape, null, 2));
    expect(shape.gutterCells).toBeGreaterThan(10);
  } finally {
    await app.close();
    repo.cleanup();
  }
});
