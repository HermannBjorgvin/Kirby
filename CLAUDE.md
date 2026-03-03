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

---

# Workflow Manager Development Guide

## Core Process

1. **One feature at a time.** Implement the smallest possible increment that can be visually verified or tested. Never batch multiple features into a single pass.
2. **Visual first for TUI work.** Get something on screen before building supporting infrastructure. Mock data is fine — proving the rendering/interaction works is the priority.
3. **Check in at every milestone.** After each feature, stop and tell the user:
   - What was implemented
   - How to test it manually (exact commands)
   - Wait for their feedback before continuing
4. **Don't build what you can't verify.** If behavior depends on real-world interaction (e.g. Claude session status patterns), don't guess — build a testable mock first, observe the real thing, then implement.
5. **Commit after every code-generating or install command.** NX generators, `npm install`, `npm uninstall` — commit immediately before making manual changes.
6. **Iterate with the user, not ahead of the user.** The user is part of the development loop. Their manual QA testing is essential. Don't race ahead building layers of code they haven't seen yet.

## Ink.js / TUI Patterns

- **Use the `cli-design:inkjs-design` skill** for component patterns, layout, input handling, testing, and gotchas. Check it before guessing at Ink APIs.
  - `cli-design:inkjs-cli layout` — responsive layout, `useStdout` for terminal dimensions
  - `cli-design:inkjs-cli testing` — `ink-testing-library` patterns
  - `cli-design:inkjs-cli input` — keyboard input, `useInput` patterns
  - `cli-design:inkjs-cli gotchas` — emoji width, Ctrl+C, useInput conflicts
- **Full-screen layout:** Use `useStdout()` to get `rows`/`columns`, set `height={rows}` on root `<Box>`.
- **PTY sizing:** The PTY session is sized to match the terminal dimensions minus UI chrome (sidebar width, borders, status bar).
- **ESM required:** Ink v6 + yoga-layout use top-level await. All packages must have `"type": "module"` in package.json.

## Testing Strategy

- **TDD for libraries:** `worktree-manager` (worktree.ts) — mock `exec`, test parsing and CRUD logic.
- **Ink components:** Use `ink-testing-library` to verify text content + keyboard navigation. No real TTY needed.
- **Manual testing for:** ANSI/visual rendering, PTY input forwarding, anything involving real terminal interaction.
- **Run tests via NX:** `npx nx test worktree-manager`
- **Dev run:** `npx nx serve cli` (rebuilds stale lib deps, then runs via tsx)

## Project Structure

```
apps/cli/              — Ink TUI application (ESM, React 19)
  src/main.tsx         — Entry point, root component
  src/pty-registry.ts  — PTY session lifecycle (spawn, get, kill)
libs/worktree-manager/ — Git worktree and branch operations
  src/lib/worktree.ts  — Worktree CRUD, branch utils, conflict checks
libs/terminal/         — PTY session + terminal emulation (node-pty + @xterm/headless)
  src/lib/pty-session.ts       — node-pty wrapper
  src/lib/terminal-emulator.ts — @xterm/headless wrapper with ANSI rendering
```

## Known Decisions & Learnings

- **ANSI passthrough works:** TerminalEmulator (@xterm/headless) renders ANSI output which Ink `<Text>` passes directly to the terminal. Colors, bold, underline all render correctly.
- **Input forwarding works:** Raw stdin → PTY write round-trip is responsive enough for interactive use. Mouse tracking and scrollback navigation are supported.
- **NX workspace uses `apps/*` + `libs/*`** (not default `packages/*`). Workspaces configured in root package.json.
- **`npx nx sync`** may be needed when adding cross-library dependencies (e.g. worktree-manager importing terminal).
- **`TSX_TSCONFIG_PATH`:** The serve target sets this env var so tsx picks up `jsx: "react-jsx"` from `tsconfig.app.json`. Without it, tsx defaults to classic JSX transform and requires `import React`.
