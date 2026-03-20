# Senior Ink Reviewer Memory

## Project Structure

- `apps/cli/` -- Ink v6 TUI app (React 19, ESM-only), entry at `src/main.tsx`
  - `src/components/` -- Shared components (SidebarLayout, TerminalView, TabBar, etc.)
  - `src/screens/sessions/` -- Sessions tab (SessionsTab, Sidebar, BranchPicker, sessions-input)
  - `src/screens/reviews/` -- Reviews tab (ReviewsTab, ReviewsSidebar, ReviewPane, reviews-input)
  - `src/context/` -- React contexts (AppState, Session, Review, Config)
  - `src/hooks/` -- Custom hooks (useTerminal, useDiffData)
- `libs/worktree-manager/` -- Git worktree and branch operations
- `libs/terminal/` -- PTY session + terminal emulation (node-pty + @xterm/headless)
- `libs/vcs-core/` -- VCS provider abstraction (config, PR types)
- `libs/vcs-github/`, `libs/vcs-azure-devops/` -- VCS provider implementations
- Serve target uses `nx:run-commands` with tsx for ESM compat (not @nx/js:node)

## Key Architectural Issues (2026-03-07 full review, updated after refactor)

- **State split into contexts**: AppStateContext, SessionContext, ReviewContext, ConfigContext (previously a single god object)
- **Input handlers split by feature**: `screens/sessions/sessions-input.ts` and `screens/reviews/reviews-input.ts` with shared helpers in `input-handlers.ts`
- **main.tsx slimmed down**: ~136 lines, delegates to SessionsTab and ReviewsTab screen components
- **pty-registry.ts**: module-level mutable Map singleton, no React integration
- **No error boundaries** -- unhandled error crashes entire TUI
- **Test files** for cli app: `pr-utils.spec.ts`, `session-sort.spec.ts`
- **No resize listener** -- `useStdout().stdout.rows/columns` doesn't update on resize

## Ink Patterns

- Two `useTerminal` instances (sessions + reviews) with independent PTY connections
- `useRawStdinForward`: raw stdin -> PTY with mouse event handling, Ctrl+Space escape
- `usePtySession`: 16ms debounced render via setTimeout, ref-based callback pattern
- Four React contexts: ConfigContext, AppStateContext, SessionContext, ReviewContext
- Components use `memo()` appropriately: TerminalView, BranchPicker, ReviewPane, TabBar
- overflow="hidden" + wrap="truncate" on TerminalView for content clipping

## Recurring Issues

- Shell injection risk in git functions using string interpolation
- Stale closures in event handlers -- use functional setState form
- Stale closure risk in `findSortedIndex` useCallback (closes over sessionPrMap): works by accident because PR data doesn't refresh in same async flow as session creation. Document or pass explicitly.
- Duplicated logic (branch filtering computed in both input handler and BranchPicker)
- No useWindowSize() for terminal resize

## Review History

- 2026-02-25: Reviewed perf async conversion + serve target cleanup
- 2026-02-26: Reviewed xterm-headless removal, self-managed worktrees feature
- 2026-03-07: Full codebase review of apps/cli/src/ -- see detailed findings in review output
- 2026-03-17: Session sort bug fix review -- sorted index extracted to `utils/session-sort.ts`, stale closure concern flagged
