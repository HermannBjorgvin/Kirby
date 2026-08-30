import { expect, test, type Page } from '@playwright/test';
import { createBigRepo } from './setup/big-repo.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';
import {
  collect,
  duringInteraction,
  heapMb,
  saveSamples,
  workerPhases,
  type Samples,
} from './setup/metrics.js';

/**
 * The diff viewer on a pull-request-sized change.
 *
 * What a reviewer feels, measured as separate things because different
 * fixes move different ones:
 *
 *   openMs         click the row → the first line of code exists
 *   highlightMs    → that code is syntax-coloured
 *   parseMs        the worker round trip that splits the patch
 *   analyzeMs      the worker round trip that highlights one file
 *   settleMs       after a fast scroll stops, until the screen is
 *                  readable — the only metric that can tell the
 *                  highlighter's *scheduling* apart, since the total
 *                  work is the same either way
 *
 * Selectors are `data-diff-scroll` and `data-row-kind`, not classes:
 * `.tabular-nums` and `.overflow-auto` both also match the sidebar,
 * and an earlier version of this file measured that by accident and
 * reported a beautifully fast diff viewer it had never looked at.
 */

const ITERATIONS = Number(process.env.KIRBY_PERF_ITERATIONS ?? 5);
const SCROLL_STEPS = 60;

const CODE_ROW = '[data-diff-scroll] [data-row-kind="unified"]';
const COLOURED = `${CODE_ROW} span[style*="color"]`;

/**
 * Flick through the whole diff in about a second, the way someone
 * skims a review they have already been through once.
 *
 * Driven from inside the page rather than with `mouse.wheel`. Every
 * Playwright input event is a round trip to the browser, which paced
 * the scroll at something like four seconds however small the delay —
 * slow enough that the highlighter kept up no matter how its queue was
 * ordered, and the metric said nothing. One `scrollTop` step per
 * animation frame is both faster and closer to what a trackpad flick
 * actually does.
 */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async (steps: number) => {
    const el = document.querySelector('[data-diff-scroll]');
    if (!el) return;
    const step = el.scrollHeight / steps;
    for (let i = 0; i < steps; i++) {
      el.scrollTop += step;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }, SCROLL_STEPS);
  // One frame for the last scroll to have produced its render.
  await pace(page, 50);
}

/** The fraction of on-screen code rows that have been coloured. */
const LIT_FRACTION = `(() => {
  const el = document.querySelector('[data-diff-scroll]');
  if (!el) return 1;
  const box = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll('[data-row-kind="unified"]')].filter((r) => {
    const b = r.getBoundingClientRect();
    return b.bottom > box.top && b.top < box.bottom;
  });
  if (rows.length === 0) return 1;
  const lit = rows.filter((r) => r.querySelector('span[style*="color"]'));
  return lit.length / rows.length;
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
  test.setTimeout(180_000 * ITERATIONS);
  const repo = createBigRepo({ files: 40, linesPerFile: 600 });
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
            .locator(CODE_ROW)
            .first()
            .waitFor({ state: 'visible', timeout: 60_000 });
          const openMs = Date.now() - t0;
          await page
            .locator(COLOURED)
            .first()
            .waitFor({ state: 'visible', timeout: 60_000 });
          return { openMs, highlightMs: Date.now() - t0 };
        });
        const phases = await workerPhases(page);

        const scroll = await duringInteraction(page, () => scrollThrough(page));
        const litAtRest = await litFraction(page);
        const settled = await settleMs(page, 30_000);
        // After the flick: how many files the highlighter was asked
        // for in total, and how long the slowest answer took.
        const after = await workerPhases(page);

        collect(samples, {
          openMs: open.result.openMs,
          highlightMs: open.result.highlightMs,
          ...phases,
          openBlockingMs: open.metrics.blockingMs,
          openLongestTaskMs: open.metrics.longestTaskMs,
          scrollBlockingMs: scroll.metrics.blockingMs,
          scrollTaskMs: scroll.metrics.taskMs,
          scrollLongestTaskMs: scroll.metrics.longestTaskMs,
          scrollFrameP95Ms: scroll.metrics.frameP95Ms,
          scrollSlowFrames: scroll.metrics.framesOver32ms,
          // 0–100: how much of the last screenful was already readable
          // the moment scrolling stopped.
          litAtRestPct: litAtRest * 100,
          settleMs: settled,
          scrollAnalyzeCount: after.analyzeCount,
          scrollAnalyzeWorstMs: after.analyzeWorstMs,
          scrollAnalyzeTotalMs: after.analyzeTotalMs,
          heapMb: await heapMb(page),
        });
      } finally {
        await app.close();
      }
    }
  } finally {
    repo.cleanup();
  }

  for (const key of ['openMs', 'highlightMs', 'settleMs'] as const) {
    expect(samples[key], `${key} was never recorded`).toHaveLength(ITERATIONS);
  }

  saveSamples('diff-viewer', samples);
});
