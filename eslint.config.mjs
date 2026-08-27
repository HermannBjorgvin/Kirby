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
              message: 'No barrel imports — import from the concrete file.',
            },
          ],
        },
      ],
      '@nx/enforce-module-boundaries': [
        'error',
        {
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
          ],
        },
      ],
    },
  },
  {
    // Build/release scripts are workspace tooling, not application
    // code: they run from the repo root with plain node and are meant
    // to reach shared helpers there (e.g. scripts/shared-version.mjs).
    // The module-boundary rule guards the app/lib dependency graph,
    // which these files are not part of.
    files: ['apps/*/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    rules: {
      '@nx/enforce-module-boundaries': 'off',
    },
  },
  {
    // The desktop renderer is a sandboxed browser context: no Node, no
    // `require`. Importing a *value* from a library that touches
    // node:fs (or a native module) pulls that builtin into the bundle,
    // where it cannot work — the dev server happily serves it and the
    // window renders black on launch, with the real cause buried in a
    // Vite warning. Types are erased at compile time and stay allowed,
    // which is how the renderer already consumes these libraries.
    //
    // Anything the renderer genuinely needs at runtime belongs behind
    // the host bridge (src/host/contract.ts) or in a browser-safe entry
    // point, the way @kirby/vcs-core exposes its `./types` subpath.
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            '@kirby/app-core',
            '@kirby/logger',
            '@kirby/review-comments',
            '@kirby/terminal-pty',
            '@kirby/terminal-tmux',
            '@kirby/vcs-core',
            '@kirby/vcs-github',
            '@kirby/worktree-manager',
          ].map((name) => ({
            name,
            allowTypeImports: true,
            message:
              `${name} runs on Node and cannot be imported for its values ` +
              'in the sandboxed renderer. Use `import type`, go through ' +
              'window.kirby, or import a browser-safe subpath.',
          })),
        },
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
      '**/eslint.config.mjs',
    ],
  }
);
