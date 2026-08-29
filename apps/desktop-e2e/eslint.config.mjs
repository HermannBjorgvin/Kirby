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
