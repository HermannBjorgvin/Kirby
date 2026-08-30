import { expect, test, type Page } from '@playwright/test';
import { createBigRepo } from './setup/big-repo.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';
import {
  collect,
  duringInteraction,
  heapMb,
  saveSamples,
  type Samples,
} from './setup/metrics.js';

/**
 * The diff viewer on a pull-request-sized change.
 *
 * Three things a reviewer feels, measured separately because different
 * fixes move different ones:
 *
 *   openMs         click the row → the first diff row exists
 *   highlightMs    → the first shiki-coloured token exists
 *   scroll*        main-thread cost of dragging through the whole diff
 *
 * `blockingMs` (time spent in the part of each task past 50 ms) is the
 * headline: it is what makes a scroll feel like it is catching, and it
 * is what moving work off the main thread or skipping a re-render is
 * supposed to remove.
 */

const ITERATIONS = Number(process.env.KIRBY_PERF_ITERATIONS ?? 5);
const SCROLL_STEPS = 120;

/**
 * Read the whole diff, top to bottom, at a brisk but human pace.
 *
 * The step size is derived from the document rather than fixed: this
 * fixture is ~217 000 px tall, so a plausible-looking constant covered
 * a tenth of it and never touched most of the files — which is exactly
 * where the cost is, since every new file on screen is another
 * tokenization. Covering the whole thing is what makes the number mean
 * "reviewing this pull request", and it is the only reason the metric
 * responds to the highlighter at all.
 */
async function scrollThrough(page: Page): Promise<void> {
  const scroller = page.locator('.overflow-auto').last();
  await scroller.hover();
  const height = await scroller.evaluate((el) => el.scrollHeight);
  const step = Math.max(400, Math.ceil(height / SCROLL_STEPS));
  for (let i = 0; i < SCROLL_STEPS; i++) {
    await page.mouse.wheel(0, step);
    await pace(page, 30);
  }
}

/**
 * The fraction of on-screen code rows that have been syntax-coloured.
 *
 * This is the number a reviewer actually experiences after a scroll:
 * the rows are there, but are they *readable* yet. It is also the only
 * metric that can tell the highlighter's scheduling apart — total work
 * done is the same either way, and what changes is whether the file
 * under the cursor is first in the queue or twenty-fourth.
 */
const LIT_FRACTION = `(() => {
  const panes = document.querySelectorAll('.overflow-auto');
  const el = panes[panes.length - 1];
  if (!el) return 1;
  const box = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll('[data-index]')].filter((r) => {
    const b = r.getBoundingClientRect();
    return b.bottom > box.top && b.top < box.bottom;
  });
  const code = rows.filter((r) => r.querySelector('.tabular-nums'));
  if (code.length === 0) return 1;
  const lit = code.filter((r) => r.querySelector('span[style*="color"]'));
  return lit.length / code.length;
})()`;

async function litFraction(page: Page): Promise<number> {
  return page.evaluate(LIT_FRACTION) as Promise<number>;
}

/** How long after a scroll stops until the viewport is readable. */
async function settleMs(page: Page, timeout: number): Promise<number> {
  const t0 = Date.now();
  try {
    await page.waitForFunction(`${LIT_FRACTION} >= 0.9`, undefined, {
      timeout,
      polling: 50,
    });
  } catch {
    return timeout;
  }
  return Date.now() - t0;
}

test('diff viewer', async () => {
  test.setTimeout(120_000 * ITERATIONS);
  const repo = createBigRepo();
  const samples: Samples = {};

  try {
    for (let i = 0; i < ITERATIONS; i++) {
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

        const open = await duringInteraction(page, async () => {
          const t0 = Date.now();
          await row.click();
          await page
            .locator('.tabular-nums')
            .first()
            .waitFor({ state: 'visible', timeout: 60_000 });
          const openMs = Date.now() - t0;
          await page
            .locator('span[style*="color"]')
            .first()
            .waitFor({ state: 'visible', timeout: 60_000 });
          return { openMs, highlightMs: Date.now() - t0 };
        });

        const scroll = await duringInteraction(page, () => scrollThrough(page));
        const litAtRest = await litFraction(page);
        const settled = await settleMs(page, 20_000);

        collect(samples, {
          openMs: open.result.openMs,
          highlightMs: open.result.highlightMs,
          openBlockingMs: open.metrics.blockingMs,
          openLongestTaskMs: open.metrics.longestTaskMs,
          scrollBlockingMs: scroll.metrics.blockingMs,
          scrollTaskMs: scroll.metrics.taskMs,
          scrollLongestTaskMs: scroll.metrics.longestTaskMs,
          scrollFrameP95Ms: scroll.metrics.frameP95Ms,
          scrollSlowFrames: scroll.metrics.framesOver32ms,
          // 0–1: how much of the last screenful was already readable
          // the moment scrolling stopped.
          litAtRestPct: litAtRest * 100,
          settleMs: settled,
          heapMb: await heapMb(page),
        });
      } finally {
        await app.close();
      }
    }
  } finally {
    repo.cleanup();
  }

  for (const key of ['openMs', 'highlightMs', 'scrollBlockingMs'] as const) {
    expect(samples[key], `${key} was never recorded`).toHaveLength(ITERATIONS);
  }

  saveSamples('diff-viewer', samples);
});
