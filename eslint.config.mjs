import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import importPlugin from 'eslint-plugin-import';
import vitest from '@vitest/eslint-plugin';
import ink from './tools/eslint-plugin-ink.mjs';

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
    // Size and shape budgets.
    //
    // Warnings, deliberately: the codebase predates them and the point
    // is a downward ratchet, not a wall. They exist mostly to bound
    // what gets *added* — a file grows past 300 lines and a function
    // past 20 branches one plausible-looking edit at a time, and that
    // is the growth nobody reviews as growth.
    //
    // `complexity` starts at 20 (21 functions over) rather than the
    // conventional 10 (90 over), so the list stays short enough to act
    // on. Tighten to 15, then 12, as it clears. The current worst are
    // the TUI's three `*-input.ts` keyboard handlers — 89, 52 and 49,
    // and genuinely `if`-chains rather than `switch` dispatch, which is
    // the refactor the number is pointing at.
    files: ['apps/**/*.{ts,tsx}', 'libs/**/*.{ts,tsx}'],
    rules: {
      'max-lines': [
        'warn',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      complexity: ['warn', { max: 20 }],
      'max-depth': ['error', 4],
    },
  },
  {
    // Two files are large because the thing they describe is large: a
    // REST surface and an action catalog. Splitting either one spreads
    // a single lookup table across files without making any part of it
    // easier to read, so they get a ceiling instead of an exemption.
    files: [
      'libs/vcs/*/src/lib/provider.ts',
      'libs/app-core/src/lib/keybindings/registry.ts',
    ],
    rules: {
      'max-lines': [
        'warn',
        { max: 900, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    // A long spec file is usually a well-covered unit, not a design
    // problem — the cases are independent and splitting them by line
    // count separates a behaviour from its siblings. Complexity still
    // applies: a branchy test is a test whose own correctness is in
    // question.
    files: ['**/*.spec.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
    },
  },
  {
    // Type-aware rules. These need the TS program, which costs about
    // 19s across the workspace — worth it, because everything here is
    // a failure that types alone do not catch and review reliably
    // misses.
    //
    // `no-floating-promises` is the reason this block exists: Kirby is
    // almost entirely async git, PTY and provider calls, and a dropped
    // promise there is a silent no-op followed by an unhandled
    // rejection. `ignoreVoid` keeps deliberate fire-and-forget
    // expressible — write `void doThing()` and the intent is on the
    // page instead of in the author's head.
    files: ['apps/*/src/**/*.{ts,tsx}', 'libs/**/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': [
        'warn',
        { ignoreVoid: true, ignoreIIFE: true },
      ],
      '@typescript-eslint/no-misused-promises': [
        'warn',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/await-thenable': 'warn',
      // Adding a member to a union and forgetting one of the switches
      // that reads it is the single most common way a feature half
      // lands here. A `default` clause counts as handling it.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'warn',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    // Ink enforces its layout contract at runtime by throwing, so a
    // component that breaks it type-checks, builds, ships, and takes
    // down the TUI the first time that branch renders. See
    // tools/eslint-plugin-ink.mjs for why these are local rules.
    //
    // Both layout rules are clean today and stay that way: they cost
    // nothing now and catch a class of crash that is otherwise found
    // by a user.
    files: ['apps/cli/src/**/*.{ts,tsx}', 'libs/app-core/src/**/*.{ts,tsx}'],
    plugins: { ink },
    rules: {
      'ink/no-raw-text': 'error',
      'ink/no-layout-inside-text': 'error',
      'ink/no-bare-process-exit': 'error',
    },
  },
  {
    // The entry point owns shutdown, and `kirby util` subcommands are
    // plain CLI with no Ink tree to unmount. Exiting the process is
    // their job; the rule is about components reaching for it.
    files: ['apps/cli/src/main.tsx', 'apps/cli/src/commands/**/*.ts'],
    rules: {
      'ink/no-bare-process-exit': 'off',
    },
  },
  {
    // React rules that apply wherever we render.
    files: ['apps/**/*.tsx', 'libs/**/*.tsx'],
    rules: {
      'react/no-array-index-key': 'warn',
    },
  },
  {
    // DOM-only rules: the desktop renderer is the one place with real
    // HTML elements. A <button> without an explicit type defaults to
    // `submit`, which inside a form navigates instead of doing what
    // the handler says.
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'react/button-has-type': 'warn',
      'react/jsx-no-target-blank': 'error',
    },
  },
  {
    // Unit tests (`*.spec.*`, vitest). The e2e suites are Playwright
    // and get the equivalent guards from eslint-plugin-playwright in
    // their own configs.
    //
    // `no-focused-tests` is the one that matters: a stray `.only`
    // leaves CI green while running a single test, which is worse than
    // a red build because nothing signals it.
    files: ['**/*.spec.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/valid-expect': 'error',
      'vitest/valid-describe-callback': 'error',
      'vitest/require-to-throw-message': 'off',
      'vitest/expect-expect': 'warn',
      'vitest/no-conditional-expect': 'warn',
      'vitest/no-standalone-expect': 'warn',
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
