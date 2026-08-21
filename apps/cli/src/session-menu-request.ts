// One-shot request to open the session menu for a session on the next
// pane mount.
//
// The branch picker creates a worktree, then moves the sidebar
// selection to the new session's row. Selection changes remount
// MainTabBody (and with it the pane reducer), so any pane state set
// before the move is lost. This module-level mailbox survives the
// remount: the picker files a request keyed by the session name, and a
// mount effect in `usePaneReducer` consumes it when the pane mounts for
// an item resolving to that session, opening the session menu.
//
// Keyed by session name rather than sidebar item key because the row
// for a branch that already has a PR keeps its `review:<id>` identity
// (see translateSelectKey in SidebarContext) — but both row kinds
// resolve the same `sessionNameForTerminal`.
//
// A request only survives until the next mount, whichever item it is
// for: the selection move it accompanies produces exactly one remount,
// and if that lands somewhere unexpected the request must not linger
// and pop the menu on a later unrelated navigation.
//
// Pure module, no React — same pattern as inactive-alerts.ts.

let pending: string | null = null;

export function requestSessionMenu(sessionName: string): void {
  pending = sessionName;
}

/**
 * Take the pending request. Always clears it; returns true only when it
 * targets `sessionName`.
 */
export function consumeSessionMenuRequest(
  sessionName: string | null | undefined
): boolean {
  const taken = pending;
  pending = null;
  return taken !== null && taken === sessionName;
}

export function __resetForTests(): void {
  pending = null;
}
