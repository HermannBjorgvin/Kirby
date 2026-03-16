import { defineConfig } from '@microsoft/tui-test';

export default defineConfig({
  retries: 1,
  timeout: 15_000,
  workers: 1,
  testMatch: 'src/**/*.test.ts',
  use: {
    rows: 30,
    columns: 100,
  },
});
