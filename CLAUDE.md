@AGENTS.md

## Claude Code

- A `PostToolUse` hook (`tools/lint-hook.mjs`) lints every file you write from
  the directory whose ESLint config owns it and blocks the edit with ESLint's
  output. Fix the report; do not suppress it.
- The `nx` plugin provides the Nx MCP server the `AGENTS.md` block refers to.
- Interactive TUI QA: attach the Playwright MCP to a Chrome the user has
  started on CDP port 9222 (see `docs/testing.md`); it never spawns its own.
