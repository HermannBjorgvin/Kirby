import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/libs/core',
  test: {
    name: '@kirby/core',
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    // Pins TMUX_TMPDIR to a throwaway dir and drops $TMUX before any
    // spec loads — this project shells out to real tmux. See
    // vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
