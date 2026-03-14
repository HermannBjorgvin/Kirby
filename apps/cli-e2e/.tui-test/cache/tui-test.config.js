//# hash=2637e5f910d5d81a735417b34b43b5e4
//# sourceMappingURL=tui-test.config.js.map

import { defineConfig } from '@microsoft/tui-test';
export default defineConfig({
  retries: 1,
  timeout: 15000,
  workers: 1,
  testMatch: 'src/**/*.test.ts',
  use: {
    rows: 30,
    columns: 100,
  },
});
