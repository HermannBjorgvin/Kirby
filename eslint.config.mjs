import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    plugins: {
      react,
      'react-hooks': reactHooks,
      import: importPlugin,
    },
    settings: { react: { version: '19.2' } },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    rules: {
      // Too aggressive for this codebase — common pattern after null checks and array access
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      'react/jsx-key': 'error',
      'react/no-unstable-nested-components': 'error',
      'react/jsx-no-constructed-context-values': 'error',
      'react/self-closing-comp': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'import/no-cycle': ['error', { maxDepth: 3 }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/index'],
              message:
                'No barrel imports — import from the concrete file.',
            },
          ],
        },
      ],
    },
  },
  // Typed linting — scoped to production source only.
  // Spec files, config files, and test-utils aren't in any tsconfig,
  // so projectService can't parse them; we skip typed rules there.
  // Regular lint rules still run on those files via the blocks above.
  {
    files: ['**/src/**/*.{ts,tsx,cts,mts}'],
    ignores: [
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test-utils/**',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out-tsc',
      'tmp',
      '.claude/worktrees',
      '**/.tui-test',
    ],
  }
);
