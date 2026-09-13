@AGENTS.md

## Linting

`tools/lint-hook.mjs` reports issues after Write/Edit using the owning ESLint
config. Fix reported issues; the hook does not undo the edit.
See [linting guidance](docs/linting.md).

## Tools

- The enabled Nx plugin supplies Nx MCP. Use `npx nx` if it is unavailable.
- The configured Playwright MCP attaches to Chrome on CDP port 9222.
  See `docs/testing.md` for interactive QA setup.
