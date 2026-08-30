import { expect, test, type Page } from '@playwright/test';
import { cleanupTestRepo, createTestRepo } from '../src/setup/git-repo.js';
import { paletteInput, sidebarRow, tab } from '../src/setup/app.js';
import { launchApp, unthrottle } from './setup/launch.js';
import { pace } from './setup/pace.js';
import {
  collect,
  duringInteraction,
  idleCost,
  saveSamples,
  type Samples,
} from './setup/metrics.js';

/**
 * The small interactions, and the cost of doing nothing.
 *
 * Startup happens once and the diff viewer only while reviewing; this
 * is the rest of the day. Opening the palette, typing into it and
 * moving between tabs are the actions performed hundreds of times, and
 * they are where React render cost shows up as a feel rather than as a
 * number anyone would think to measure.
 *
 * `idle*` is the other half. A window sitting open still polls the host
 * for sessions, agent activity, drafts and the sidebar model — every
 * one an IPC call with git or a config read behind it. On a machine
 * that keeps this app open all day, that is the fan.
 */

const ITERATIONS = Number(process.env.KIRBY_PERF_ITERATIONS ?? 5);
const IDLE_MS = Number(process.env.KIRBY_PERF_IDLE_MS ?? 8_000);
const BRANCHES = ['perf-one', 'perf-two', 'perf-three', 'perf-four'];

/** Ctrl+K, then how long until the palette is on screen. */
async function openPaletteTimed(page: Page): Promise<number> {
  const t0 = Date.now();
  await page.keyboard.press('Control+k');
  await paletteInput(page).waitFor({ state: 'visible', timeout: 10_000 });
  return Date.now() - t0;
}

/** Type a query and wait for the list to narrow to it. */
async function filterPaletteTimed(page: Page, query: string): Promise<number> {
  const t0 = Date.now();
  await paletteInput(page).fill(query);
  await page
    .getByRole('option')
    .filter({ hasText: query })
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  return Date.now() - t0;
}

/**
 * Flip between two open tabs and report the worst switch.
 *
 * Worst rather than mean: a switch that is usually instant and
 * occasionally is not is exactly what "feels laggy" describes, and an
 * average hides it. Nothing here calls the host — panes stay mounted
 * and switching only changes which one is visible — so whatever this
 * costs is React.
 */
async function flipTabs(page: Page, times: number): Promise<number> {
  let worst = 0;
  for (let n = 0; n < times; n++) {
    const name = BRANCHES[n % 2];
    const t0 = Date.now();
    await tab(page, new RegExp(name)).first().click();
    await expect(tab(page, new RegExp(name)).first()).toHaveAttribute(
      'aria-selected',
      'true'
    );
    worst = Math.max(worst, Date.now() - t0);
  }
  return worst;
}

test('interactions and idle', async () => {
  test.setTimeout((90_000 + IDLE_MS) * ITERATIONS);
  const repoPath = createTestRepo({
    name: 'kirby-perf',
    worktrees: BRANCHES.map((branch) => ({
      branch,
      files: {
        [`${branch}.ts`]: `export const x = '${branch}';\n`,
      },
    })),
  });
  const samples: Samples = {};

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const app = await launchApp({ repoPath });
      try {
        await unthrottle(app.app);
        const page = app.page;
        // Every seeded worktree has a row before anything is timed.
        await sidebarRow(page, new RegExp(BRANCHES[BRANCHES.length - 1]))
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });

        const palette = await duringInteraction(page, async () => {
          const openMs = await openPaletteTimed(page);
          const filterMs = await filterPaletteTimed(page, BRANCHES[2]);
          await page.keyboard.press('Escape');
          return { openMs, filterMs };
        });

        // Double-click: a single click opens a *preview* tab, which
        // the next one replaces — two single clicks would leave one
        // tab and nothing to switch between.
        for (const branch of BRANCHES.slice(0, 2)) {
          await sidebarRow(page, new RegExp(branch)).first().dblclick();
          await tab(page, new RegExp(branch))
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 });
          await pace(page, 300);
        }
        const switching = await duringInteraction(page, () =>
          flipTabs(page, 6)
        );

        const idle = await idleCost(page, app.app, IDLE_MS);

        collect(samples, {
          paletteOpenMs: palette.result.openMs,
          paletteFilterMs: palette.result.filterMs,
          paletteBlockingMs: palette.metrics.blockingMs,
          paletteLongestTaskMs: palette.metrics.longestTaskMs,
          tabSwitchWorstMs: switching.result,
          tabSwitchBlockingMs: switching.metrics.blockingMs,
          tabSwitchLongestTaskMs: switching.metrics.longestTaskMs,
          ...idle,
        });
      } finally {
        await app.close();
      }
    }
  } finally {
    cleanupTestRepo(repoPath);
  }

  for (const key of [
    'paletteOpenMs',
    'tabSwitchWorstMs',
    'idleCpuPct',
  ] as const) {
    expect(samples[key], `${key} was never recorded`).toHaveLength(ITERATIONS);
  }

  saveSamples('interaction', samples);
});
