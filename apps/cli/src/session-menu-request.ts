// One-shot request to open the session menu for a session on the next
// pane mount.
//
// The branch picker creates a worktree, then moves the sidebar
// selection to the new session's row. Selection changes remount
// MainTabBody (and with it the pane reducer), so any pane state set
// before the move is lost. This module-level mailbox survives the
// remount: the picker files a request keyed by the session name, and
// `usePaneReducer`'s lazy initializer consumes it when it mounts for an
// item resolving to that session, starting with the session menu open.
//
// Keyed by session name rather than sidebar item key because the row
// for a branch that already has a PR keeps its `review:<id>` identity
// (see translateSelectKey in SidebarContext) — but both row kinds
// resolve the same `sessionNameForTerminal`.
//
// Pure module, no React — same pattern as inactive-alerts.ts.

let pending: string | null = null;

export function requestSessionMenu(sessionName: string): void {
  pending = sessionName;
}

/**
 * Consume the pending request if it targets `sessionName`. Returns true
 * exactly once per request; a mount for a different session leaves the
 * request in place (the selection move may not have landed yet).
 */
export function consumeSessionMenuRequest(
  sessionName: string | null | undefined
): boolean {
  if (pending === null || pending !== sessionName) return false;
  pending = null;
  return true;
}

export function __resetForTests(): void {
  pending = null;
}
