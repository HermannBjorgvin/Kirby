import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

// KIRBY_E2E_PORT lets parallel checkouts (git worktrees, concurrent
// agent sessions) run their own wterm host without colliding on 5174 —
// with reuseExistingServer, a port collision silently attaches this
// suite to ANOTHER worktree's host (stale build, foreign PTY input).
const port = Number(process.env.KIRBY_E2E_PORT ?? 5174);
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
    reuseExistingServer: !process.env.CI,
    cwd: workspaceRoot,
    stdout: 'pipe',
    timeout: 60_000,
    env: { ...process.env, PORT: String(port) },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
