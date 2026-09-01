import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/terminal-tmux',
  test: {
    name: '@kirby/terminal-tmux',
    watch: false,
    globals: true,
    environment: 'node',
    // Pins TMUX_TMPDIR to a throwaway dir and drops $TMUX before any
    // spec loads, so the live suite can never reach the developer's
    // own tmux server. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
