# apps/cli — the Ink TUI

Thin render layer over `@kirby/app-core`. `src/main.tsx` is the entry;
`src/input-handlers.ts` holds the keybind-driven state transitions; screens
under `src/screens/main` (sidebar, diff, branch picker) and
`src/screens/reviews`; pure view-models in `src/models`; Ink-coupled hooks in
`src/hooks`. Reasoning for the rules below: `docs/decisions.md`.

- Before changing Ink components or input handling, read the shared
  `building-ink-cli-apps` skill.
- Full-screen layout: `useStdout()` for rows/columns, `height={rows}` on the
  root `<Box>`. The PTY is sized to the terminal minus chrome (sidebar width,
  borders, status bar).
- Output path: `TerminalEmulator` (@xterm/headless) renders ANSI that `<Text>`
  passes straight through. Input path: raw stdin → PTY write
  (`hooks/useRawStdinForward.ts`); the Ctrl+Space (`\x00`) escape to the
  sidebar is hardcoded there, outside `keybindings/registry.ts`.
- Ink lint rules (`tools/eslint-plugin-ink.mjs`): `no-raw-text`,
  `no-layout-inside-text`, `no-bare-process-exit` (off for `main.tsx` and
  `commands/**`, which own exiting). Ink throws at runtime for these, so a
  violation type-checks and dies when the branch first renders.
- The serve target sets `TSX_TSCONFIG_PATH` so tsx uses `jsx: react-jsx`;
  without it every file needs `import React`.
- Ink paints nothing when `CI`, `CONTINUOUS_INTEGRATION` or `GITHUB_ACTIONS`
  is set. Strip them from any env that spawns Kirby.
- `input-handlers.ts:canApplyFieldChange` gates the `terminalBackend` toggle:
  refused while any session exists, refused toward tmux when the probe reports
  it unavailable. The desktop enforces the same host-side.
- Worktree removal here (`performDelete`: kill session → remove worktree →
  delete branch) does not call `killPersistedTmuxSession`; the desktop's does.
  Move the sequence to core rather than patching one side.
- `usePrData` polls the provider itself; it is the only reader in this process.
  The desktop reads a shared cache instead.
- Rows are named by branch here; the desktop names a PR row by its title.
- Tests: `ink-testing-library` for text content and keyboard navigation. ANSI
  rendering, PTY forwarding and real terminal interaction are manual or
  `apps/cli-e2e`. Specs are type-checked through `tsconfig.spec.json`; a new
  project must reference its spec tsconfig as well as the app one.
- `kirby util add-comment` (`src/commands/util.ts`) is how a review agent
  records drafts. It ships only in this package, so a desktop-only install
  cannot run agent reviews; both READMEs say so. Draft posting is one comment
  per `postReviewComments` call so a mid-batch failure cannot reset live
  comments to draft.
