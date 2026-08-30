import { expect, test } from '@playwright/test';
import { createBigRepo } from './setup/big-repo.js';
import { launchApp } from './setup/launch.js';
import {
  bootMetrics,
  collect,
  mainMetrics,
  saveSamples,
  waitForBoot,
  type Samples,
} from './setup/metrics.js';

/**
 * Cold start, N times over.
 *
 * Every iteration is a fresh Electron process against a fresh HOME, so
 * nothing carries over but the OS page cache — which is the honest
 * shape of a user's second launch of the day, and the one where the
 * app's own work, rather than disk, is what is left to measure.
 *
 * What the numbers mean, all from `performance.timeOrigin`:
 *   fcp          — something other than white is on screen
 *   shellMark    — the workspace shell has mounted (title bar, panes)
 *   sidebarMark  — the sidebar is showing the host's real model
 *   longTaskMs   — main thread spent this long in >50 ms tasks
 *   scriptKb     — JavaScript the renderer actually downloaded to boot
 */

const ITERATIONS = Number(process.env.KIRBY_PERF_ITERATIONS ?? 7);

test('startup', async () => {
  test.setTimeout(60_000 * ITERATIONS);
  const repo = createBigRepo({ files: 8, linesPerFile: 200 });
  const samples: Samples = {};

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const app = await launchApp({ repoPath: repo.path });
      try {
        await app.page.waitForLoadState('domcontentloaded');
        await waitForBoot(app.page, 30_000);
        const [boot, main] = await Promise.all([
          bootMetrics(app.page),
          mainMetrics(app.app),
        ]);
        collect(samples, { ...main, ...boot, launchMs: app.launchMs });
      } finally {
        await app.close();
      }
    }
  } finally {
    repo.cleanup();
  }

  // A benchmark that measured nothing must fail rather than report a
  // NaN nobody reads: every iteration has to have reached every
  // milestone for the medians below to mean anything.
  for (const key of ['fcp', 'shellMark', 'sidebarMark'] as const) {
    expect(samples[key], `${key} was never recorded`).toHaveLength(ITERATIONS);
  }

  saveSamples('startup', samples);
});
