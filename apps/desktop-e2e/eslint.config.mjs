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
    // Integration tests gate themselves on GH_TOKEN: without one there
    // is no GitHub to talk to. That is a capability check, not a
    // disabled test — the same suite runs for real in the integration
    // job. Set here rather than inline, because the pre-commit hook
    // runs eslint without this plugin registered and an inline
    // rule-specific directive fails there.
    files: ['**/*.integration.test.ts'],
    rules: {
      'playwright/no-skipped-test': 'off',
    },
  },
];
