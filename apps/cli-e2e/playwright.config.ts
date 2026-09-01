import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

// The port is machine-wide and `reuseExistingServer` attaches to
// whatever answers on it — a host left running by another worktree's
// run would quietly put *that* worktree's Kirby under test. PORT moves
// this run, host and browser alike, onto a port of its own.
const port = Number(process.env.PORT ?? 5174);
const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`;

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
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command:
      'npx nx serve cli-wterm-host --output-style=stream-without-prefixes',
    url: `http://localhost:${port}`,
    env: { PORT: String(port) },
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
