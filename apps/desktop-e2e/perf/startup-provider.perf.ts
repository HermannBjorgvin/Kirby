import { expect, test } from '@playwright/test';
import { fakeGhProjectConfig, type FakeGitHub } from '../src/setup/fake-gh.js';
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
 * Cold start for the user the app is actually for: one with a provider
 * configured.
 *
 * The other startup scenario runs against a repo with no GitHub behind
 * it, which makes the sidebar's first paint look free. It is not — the
 * host assembles that model from local worktrees *and* a remote pull
 * request list, and on a cold start there is no cache for the second
 * half. `latencyMs` puts a plausible round trip back into the picture
 * (a `gh` GraphQL search on a real repo is comfortably this slow), and
 * `sidebarMark` then measures what a user with a normal connection
 * waits for before their worktrees show up.
 */

const ITERATIONS = Number(process.env.KIRBY_PERF_ITERATIONS ?? 5);
const LATENCY_MS = Number(process.env.KIRBY_PERF_GH_LATENCY_MS ?? 700);

test('startup with a provider', async () => {
  test.setTimeout(90_000 * ITERATIONS);
  const repo = createBigRepo({ files: 8, linesPerFile: 200 });
  const scenario: FakeGitHub = {
    owner: 'kirby',
    repo: 'perf',
    username: 'kirby-perf',
    latencyMs: LATENCY_MS,
    prs: [
      {
        number: 1,
        title: 'The change under review',
        headRefName: repo.branch,
        author: 'kirby-perf',
      },
    ],
  };
  const samples: Samples = {};

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      const app = await launchApp({
        repoPath: repo.path,
        fakeGitHub: scenario,
        projectConfig: fakeGhProjectConfig(scenario),
      });
      try {
        await app.page.waitForLoadState('domcontentloaded');
        await waitForBoot(app.page, 60_000);
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

  for (const key of ['fcp', 'shellMark', 'sidebarMark'] as const) {
    expect(samples[key], `${key} was never recorded`).toHaveLength(ITERATIONS);
  }

  saveSamples('startup-provider', samples);
});
