import { defineConfig } from '@playwright/test';

/**
 * The benchmark suite, kept out of `e2e` on purpose.
 *
 * These are measurements, not assertions: each one launches the built
 * app several times over and reports medians, which takes minutes and
 * would say nothing useful in CI on a shared runner. Run it by hand
 * around a change — `nx perf desktop-e2e` before, then after — and
 * compare with `node perf/report.mjs`.
 *
 * `workers: 1` is not a convenience here, it is the measurement: a
 * second Electron app competing for the same cores would be the thing
 * the numbers described.
 */
export default defineConfig({
  testDir: './perf',
  testMatch: '**/*.perf.ts',
  outputDir: './test-output/perf',
  timeout: 15 * 60_000,
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: 'list',
});
