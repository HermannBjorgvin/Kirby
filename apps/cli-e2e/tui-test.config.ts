import { defineConfig } from '@microsoft/tui-test';

export default defineConfig({
  retries: 1,
  timeout: 120_000,
  workers: 1,
  testMatch: 'src/**/*.test.ts',
  use: {
    rows: 80,
    columns: 100,
  },
});
