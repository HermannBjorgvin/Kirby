<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

# Kirby

Kirby runs coding agents in git worktrees and reviews their pull requests. Two
shells over one core: an Ink TUI (`apps/cli`) and an Electron app
(`apps/desktop`), both rendering over `@kirby/core` (`libs/core`,
shell-agnostic) and `@kirby/app-core` (`libs/app-core`, the React layer).
Nx monorepo, npm workspaces, ESM throughout (Ink 6 needs top-level await).

Per-area notes live in `AGENTS.md` files beside the code (`apps/*/AGENTS.md`,
`libs/*/AGENTS.md`); the reasoning behind them is in `docs/`. Read the
area file before changing anything there.

## Commands

```sh
npx nx test <project>                 # vitest unit tests
npx nx run-many -t lint --all         # 0 errors, 0 warnings is the baseline
npx nx run-many -t typecheck --all
npx nx serve cli                      # run the TUI (rebuilds stale libs)
npx nx e2e cli-e2e                    # TUI e2e (Playwright + wterm), offline
npx nx e2e desktop-e2e                # launches the built Electron app, offline
npx nx e2e:visual desktop-e2e         # screenshots, pinned container, zero tolerance
GH_TOKEN=$(gh auth token) npx nx e2e:integration desktop-e2e   # live GitHub
```

- A lint **warning fails the build** (`--max-warnings 0`). Measure with `--all`:
  the three e2e projects lint under their own configs and are invisible otherwise.
- A fresh worktree needs `npm ci` before anything else; until then `nx` resolves
  the other checkout's libs. Typecheck before changing code in it.
- Pre-commit runs lint-staged. Chain `lint && git commit` with `&&` so a
  rejected commit stops the chain. `--no-verify` only for a throwaway WIP commit.

## Layering (lint-enforced)

- Sequences of git / filesystem / PTY / config / provider calls belong in
  `@kirby/core`; both shells call them. Worktree removal is already written
  twice (TUI `performDelete`, desktop `host/services/worktrees.ts`) and has
  diverged. When you touch one, move it to core rather than adding a third copy.
- `libs/core` never imports react, ink, electron or `@kirby/app-core`. The
  desktop renderer never imports `@kirby/core` values (it reaches `node:fs`);
  it uses the browser-safe `@kirby/core/plan` subpath. Neither barrel re-exports
  the other.
- Terminal backends (`libs/terminal-pty`, `libs/terminal-tmux`) implement
  `SessionBackend` and know nothing about Kirby. The `kirby-` name literal
  lives only in `libs/core/src/lib/tmux-namespace.ts`.

## How to work

- One feature at a time, smallest visually verifiable increment. After each,
  stop and tell the user what changed and the exact commands to try it.
- Get something on screen before building supporting infrastructure; mock data
  is fine. If behaviour depends on real-world interaction you cannot observe
  (agent output patterns, terminal quirks), build a testable mock first.
- Commit immediately after any generator or `npm install`, before manual edits.
- When adding a test, break the code on purpose and confirm the test fails.
  Several tests here looked thorough and caught nothing.
- Property tests (`fast-check`) use random seeds; a CI-only failure is a real
  counterexample. Pin it as a worked case.
- Budgets: `max-lines` 300, `complexity` 12, `max-depth` 4. Reach for the
  refactor before an exemption; all 47 functions that stood between 18 and 12
  came down without one. Inline `eslint-disable` needs a `--` rationale that
  says why the rule cannot apply; one naming a plugin rule fails pre-commit,
  so scope those in the project's `eslint.config.mjs`. Details: `docs/linting.md`.
- `no-floating-promises` was a crash: `asyncOps.run` never rejects and reports
  through `setOperationErrorHandler`. Do not silence the rule with `void` where
  a rejection has nowhere to go.
- `react-hooks` v7 is React Compiler analysis: a function it cannot lower
  silences every rule for that file (`try/finally` is the usual trigger).
  Six files are listed by name in `eslint.config.mjs`; a new one must not join
  quietly.

## tmux safety

The developer's default tmux server holds their live agents, and `$TMUX` beats
`TMUX_TMPDIR`. Every test or script that starts tmux pins a scratch socket dir
inside a fixture-created HOME and drops `$TMUX`. Never run `tmux kill-server`;
a scratch server exits with its last session. Never restore a `killAll()` that
kills instead of detaching. Details: `libs/terminal-tmux/AGENTS.md`.

## Git and GitHub

- Branch off `master`. Conventional commit subjects with the project as scope
  (`fix(desktop):`, `feat(core):`, `test(desktop-e2e):`).
- Reviewing a pull request: follow the `review-pr` skill (`gh api` with inline
  comments, Conventional Comments body, signed as posted by an agent).
- Publishing: the `publish-beta` skill. Both packages share one version.
- Prefer `gh` for anything GitHub.

## Reference

| Topic                                                                           | Where                  |
| ------------------------------------------------------------------------------- | ---------------------- |
| Test infrastructure (desktop and TUI e2e, fixtures, fake `gh`, integration PRs) | `docs/testing.md`      |
| Lint rules, budgets, the ratchet, why each type-aware rule exists               | `docs/linting.md`      |
| Directory layout with one-line descriptions                                     | `docs/architecture.md` |
| The reasoning behind every rule in the area files                               | `docs/decisions.md`    |
