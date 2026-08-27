import { defineConfig } from '@playwright/test';

/**
 * Electron e2e. There is no `webServer` and no browser project: each
 * test launches the *built* desktop app through Playwright's Electron
 * driver (see src/fixtures/desktop.ts), so `nx e2e desktop-e2e`
 * depends on `desktop:build`.
 *
 * Workers stay at 1. Every test gets its own repo and HOME, but the
 * app spawns real PTYs and runs real git, and a single instance at a
 * time keeps failures readable.
 */
export default defineConfig({
  testDir: './src',
  outputDir: './test-output/playwright/output',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['list'],
        [
          'html',
          { open: 'never', outputFolder: './test-output/playwright/report' },
        ],
      ]
    : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
