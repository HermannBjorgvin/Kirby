import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../eslint.config.mjs';

export default [
  playwright.configs['flat/recommended'],
  ...baseConfig,
  {
    ignores: ['**/out-tsc', '**/test-output'],
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: {},
  },
  {
    // The benchmarks in `perf/` drive the app at a fixed human cadence
    // and measure what the main thread does between the steps, so the
    // wait *is* the stimulus: an auto-waiting assertion would wait for
    // the app to go idle, which is the cost being measured, and every
    // run would report zero. Confined to the one helper that owns it
    // (`perf/setup/pace.ts`) so the rule still covers the rest of the
    // directory, and scoped here rather than inline because the
    // pre-commit hook runs eslint without the Playwright plugin, where
    // an inline directive naming one of its rules is a hard error.
    files: ['perf/setup/pace.ts'],
    rules: { 'playwright/no-wait-for-timeout': 'off' },
  },
  {
    // A test gated on a missing capability — no GH_TOKEN, no tmux — is
    // a capability check, not a disabled test: the same suite runs for
    // real in the integration job, and on a machine that has the thing.
    // `allowConditional` permits the in-body `test.skip(...)` statement
    // those use. Note what it does NOT do: the option ignores the
    // arguments, so a bare `test.skip()` in a body passes too. What
    // stays reported is the modifier form — `test.skip('name', fn)` and
    // `test.describe.skip(...)` — a test declared and marked skipped,
    // which is the one that silently stops running for good. Set here
    // rather than inline, because the pre-commit hook runs eslint
    // without this plugin registered and an inline rule-specific
    // directive fails there.
    files: ['**/*.test.ts'],
    rules: {
      'playwright/no-skipped-test': ['warn', { allowConditional: true }],
    },
  },
];
