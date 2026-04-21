import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

const baseURL = process.env.BASE_URL ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './src',
  outputDir: './test-output/playwright/output',
  timeout: 120_000,
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
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'npx nx serve cli-wterm-host --output-style=stream-without-prefixes',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    cwd: workspaceRoot,
    stdout: 'pipe',
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
