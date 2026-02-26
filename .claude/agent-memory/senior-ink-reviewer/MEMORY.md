# Senior Ink Reviewer Memory

## Project Structure
- `apps/cli/` -- Ink v6 TUI app (React 19, ESM-only), entry at `src/main.tsx`
- `libs/tmux-manager/` -- tmux commands (`tmux.ts`) + JSON persistence (`session-store.ts`)
- `libs/shared-types/` -- TypeScript interfaces
- Vitest with `globals: true` for tmux-manager (afterEach etc. available without import)
- See `patterns.md` for code conventions

## Key Decisions
- sendKeys/sendLiteral are fire-and-forget (execFile, void return) -- reviewed 2026-02-25
- capturePane returns Promise<string> via execFile callback -- reviewed 2026-02-25
- escapeArg validates session names with allowlist regex, throws on invalid
- Remaining sync functions (listSessions, hasSession, createSession, killSession, switchClient) still use execSync
- Serve target uses `nx:run-commands` with tsx for ESM compat (not @nx/js:node)
- xterm-headless REMOVED in 2336950 -- now uses capture-pane -p -e over control mode instead
- ControlConnection.capturePane() sends `capture-pane -t <target> -p -e` via sendCommand, returns resp.output
- ControlConnection.sendCommand uses -Date.now() keys for pending command tracking (queue approach)

## Ink Patterns in This Codebase
- useControlMode hook: debounced capture-pane on %output events (16ms timer)
- useInput with `creating` mode flag for modal input capture
- Full-screen layout via useStdout().rows/columns -- NO resize listener yet (gap)
- overflow="hidden" + wrap="truncate" on TerminalView for content clipping
- No error boundaries yet -- gap to track
- Ink Box width is border-box (includes border chars)
- Ink overflow="hidden" clips via Yoga getComputedHeight() -- confirmed in source

## Recurring Issues
- Shell injection via execSync with string interpolation -- new git functions (createWorktree, removeWorktree, canRemoveBranch, listBranches) don't validate inputs. Use execFileSync instead.
- Stale closures in event handlers -- performDelete captures selectedIndex; use functional setState form
- Duplicated logic between useInput handler and render components (e.g. branch filtering computed in both places)
- No useWindowSize() -- still using useStdout().stdout.rows/columns which doesn't update on resize

## Review History
- 2026-02-25: Reviewed perf async conversion + serve target cleanup commits
- 2026-02-26: Reviewed 2336950 (xterm-headless -> capture-pane). Key findings: unhandled rejection in debounced capturePane, stale-state race on session switch, effect deps include paneCols/paneRows causing reconnect on resize
- 2026-02-26: Reviewed self-managed worktrees feature (uncommitted). Key findings: shell injection in all new git functions (execSync + string interpolation), stale selectedIndex in performDelete, branchIndex -1 edge case, growing App component complexity (10+ state vars, 100-line useInput handler)
