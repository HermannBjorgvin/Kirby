import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      // Too aggressive for this codebase — common pattern after null checks and array access
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: ['**/node_modules', '**/dist', 'tmp', '.claude/worktrees'],
  }
);
