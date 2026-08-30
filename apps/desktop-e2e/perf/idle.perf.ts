import { expect, test } from '@playwright/test';
import { cleanupTestRepo, createTestRepo } from '../src/setup/git-repo.js';
import { createBigRepo } from './setup/big-repo.js';
import { fakeAgent } from '../src/fixtures/desktop.js';
import { sidebarRow } from '../src/setup/app.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';
import {
  collect,
  idleCost,
  saveSamples,
  type Samples,
} from './setup/metrics.js';

/**
 * What the app costs with an agent running and nobody watching.
 *
 * This is how the app is actually used: left open beside an editor
 * while an agent works, for hours. Everything expensive about that is
 * on a timer rather than on a click — agent output streaming into a
 * terminal, activity polled every second, sessions and draft comments
 * every two, the sidebar model and sync state every four, and a live
 * worktree diff re-fetched every two while the agent is running. None
 * of it is visible in an interaction benchmark, and all of it is fan
 * noise on a laptop.
 *
 * Measured with the agent producing output continuously, which is the
 * expensive state: every chunk is an IPC message, a terminal write and
 * a render, on top of all the polling.
 */

const ITERATIONS = Number(process.env.KIRBY_PERF_ITERATIONS ?? 3);
const IDLE_MS = Number(process.env.KIRBY_PERF_IDLE_MS ?? 10_000);
const BRANCH = 'perf-agent';

test('idle with an agent', async () => {
  test.setTimeout((90_000 + IDLE_MS * 2) * ITERATIONS);
  const repoPath = createTestRepo({
    name: 'kirby-perf',
    worktrees: [
      { branch: BRANCH, files: { 'a.ts': 'export const a = 1;\n' } },
      { branch: 'perf-other', files: { 'b.ts': 'export const b = 2;\n' } },
    ],
  });
  const samples: Samples = {};

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const app = await launchApp({
        repoPath,
        // Streams forever: the terminal keeps receiving chunks, and the
        // activity registry keeps reporting the session as active.
        kirbyConfig: {
          aiCommand: fakeAgent({ stream: true, intervalMs: 150 }),
        },
      });
      try {
        await unthrottle(app.app);
        const page = app.page;
        await sidebarRow(page, new RegExp(BRANCH))
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        // Double-clicking an idle worktree row opens its tab *and*
        // launches the agent, which is the TUI's Enter behaviour and
        // the way a user actually starts one. Waiting for the banner
        // means the measurement starts against a live session.
        await sidebarRow(page, new RegExp(BRANCH)).first().dblclick();
        await page
          .getByText('kirby-fake-agent-ready')
          .first()
          .waitFor({ state: 'visible', timeout: 60_000 });
        // Let the polls reach their steady state before counting.
        await pace(page, 3000);

        const streaming = await idleCost(page, app.app, IDLE_MS);

        collect(samples, {
          streamingCpuPct: streaming.idleCpuPct,
          streamingLongestTaskMs: streaming.idleLongestTaskMs,
          streamingLongTaskCount: streaming.idleTaskCount,
        });
      } finally {
        await app.close();
      }
    }
  } finally {
    cleanupTestRepo(repoPath);
  }

  expect(samples.streamingCpuPct, 'never recorded').toHaveLength(ITERATIONS);
  saveSamples('idle', samples);
});

/**
 * The same, on a worktree the size of a real piece of work.
 *
 * A worktree without a pull request shows a *live* diff: the host
 * re-runs a merge-base diff inside the checkout every two seconds while
 * its agent is running, so the pane tracks what the agent is doing
 * rather than what it last committed. On the two-file worktree above
 * that is free. On forty files it is a git subprocess producing
 * megabytes of patch, handed across IPC and content-hashed, fifteen
 * hundred times an hour — and the whole point of leaving the app open
 * is that the agent is working on something substantial.
 *
 * Split from the small case rather than replacing it, because the gap
 * between the two is the number that says whether this scales.
 */
test('idle with an agent on a large change', async () => {
  test.setTimeout((120_000 + IDLE_MS) * ITERATIONS);
  const repo = createBigRepo({ files: 40, linesPerFile: 600 });
  const samples: Samples = {};

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const app = await launchApp({
        repoPath: repo.path,
        kirbyConfig: {
          aiCommand: fakeAgent({ stream: true, intervalMs: 150 }),
        },
      });
      try {
        await unthrottle(app.app);
        const page = app.page;
        await sidebarRow(page, new RegExp(repo.branch))
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await sidebarRow(page, new RegExp(repo.branch)).first().dblclick();
        await page
          .getByText('kirby-fake-agent-ready')
          .first()
          .waitFor({ state: 'visible', timeout: 60_000 });
        await pace(page, 4000);

        const cost = await idleCost(page, app.app, IDLE_MS);
        collect(samples, {
          largeCpuPct: cost.idleCpuPct,
          largeLongestTaskMs: cost.idleLongestTaskMs,
          largeLongTaskCount: cost.idleTaskCount,
        });
      } finally {
        await app.close();
      }
    }
  } finally {
    repo.cleanup();
  }

  expect(samples.largeCpuPct, 'never recorded').toHaveLength(ITERATIONS);
  saveSamples('idle-large', samples);
});
