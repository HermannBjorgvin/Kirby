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

/**
 * Where the cost of opening a tab actually goes.
 *
 * Prints the host round trip for the diff, the size of the patch it
 * returns, and the same call repeated warm — so a slow open can be
 * attributed to git, to IPC, or to the renderer rather than guessed at.
 * The cold number is the one a user pays, and it is dominated by a git
 * subprocess whose cost swings threefold with the OS page cache.
 */
test('probe: what opening a tab costs', async () => {
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

    const timings = await page.evaluate(async (branch: string) => {
      const time = async (fn: () => Promise<string>) => {
        const t0 = performance.now();
        const value = await fn();
        return { ms: performance.now() - t0, length: value.length };
      };
      const cold = await time(() =>
        window.kirby.fetchWorktreeDiffText(branch, 'main')
      );
      const warm = await time(() =>
        window.kirby.fetchWorktreeDiffText(branch, 'main')
      );
      return {
        hostColdMs: Math.round(cold.ms),
        hostWarmMs: Math.round(warm.ms),
        patchKb: Math.round(cold.length / 1024),
      };
    }, repo.branch);

    console.log('[probe:open]', JSON.stringify(timings));
    expect(timings.patchKb).toBeGreaterThan(100);
  } finally {
    await app.close();
    repo.cleanup();
  }
});
