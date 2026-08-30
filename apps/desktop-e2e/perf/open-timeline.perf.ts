import { expect, test } from '@playwright/test';
import { createBigRepo } from './setup/big-repo.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';

/**
 * A timeline of one tab open, taken from inside the page.
 *
 * The diff benchmark reports how long opening a tab takes; this says
 * where it goes, which is the only way to know whether a number is
 * ours to fix. The click is timestamped in the page rather than by the
 * test runner — Playwright's actionability checks and its IPC would
 * otherwise land inside the measurement — the worker's own parse
 * measure is read off the performance timeline, and a MutationObserver
 * marks the instant the first line of code exists in the DOM.
 *
 * Diagnostic, not a benchmark: it prints and asserts only that it
 * measured something.
 */
test('open timeline', async () => {
  test.setTimeout(180_000);
  const repo = createBigRepo({ files: 40, linesPerFile: 600 });
  const app = await launchApp({ repoPath: repo.path });
  try {
    await unthrottle(app.app);
    const page = app.page;
    await page
      .getByRole('button', { name: 'New worktree', exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });
    const row = page.getByText(repo.branch, { exact: false }).first();
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    // KIRBY_PERF_SETTLE_MS: how long to leave the app alone before
    // clicking. Zero is the impatient user who clicks the instant the
    // sidebar paints; a few seconds is everyone else, and the
    // difference is whatever the idle-time prefetching bought.
    await pace(page, Number(process.env.KIRBY_PERF_SETTLE_MS ?? 0));

    await page.evaluate(() => {
      const w = window as unknown as {
        __firstRow?: number;
        __click?: number;
        __hostCall?: number;
        __hostDone?: number;
      };
      document.addEventListener(
        'click',
        () => {
          w.__click ??= performance.now();
        },
        { capture: true, once: true }
      );

      const obs = new MutationObserver(() => {
        if (document.querySelector('[data-row-kind="unified"]')) {
          w.__firstRow = performance.now();
          obs.disconnect();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });

    await row.click();
    await page
      .locator('[data-diff-scroll] [data-row-kind="unified"]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    const timeline = await page.evaluate(() => {
      const w = window as unknown as {
        __firstRow: number;
        __click: number;
        __hostCall: number;
        __hostDone: number;
      };
      const parse = performance.getEntriesByName(
        'kirby:diff:parse',
        'measure'
      )[0];
      const host = performance.getEntriesByName(
        'kirby:diff:fetch',
        'measure'
      )[0];
      const start = parse?.startTime ?? NaN;
      const end = start + (parse?.duration ?? NaN);
      return {
        clickToFirstRowMs: Math.round(w.__firstRow - w.__click),
        clickToHostCallMs: Math.round((host?.startTime ?? NaN) - w.__click),
        hostMs: Math.round(host?.duration ?? NaN),
        parseMs: Math.round(parse?.duration ?? NaN),
        parseEndToFirstRowMs: Math.round(w.__firstRow - end),
      };
    });

    console.log('[open-timeline]', JSON.stringify(timeline));
    expect(timeline.clickToFirstRowMs).toBeGreaterThan(0);
  } finally {
    await app.close();
    repo.cleanup();
  }
});
