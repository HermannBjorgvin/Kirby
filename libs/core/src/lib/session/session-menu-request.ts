// A request to open the session menu for a session, from a place that
// cannot open it directly.
//
// The branch picker creates a worktree, then moves the sidebar
// selection to the new session's row. Selection changes remount the
// pane (and with it the pane reducer), so any pane state set before
// the move is lost — and the refresh that precedes the move can itself
// remount the pane, on a schedule the picker cannot see. So the picker
// files a request keyed by the session name, and `usePaneReducer`
// consumes it from whichever pane ends up showing that session:
// the one already mounted (no selection move needed) or the one the
// move mounts next.
//
// Keyed by session name rather than sidebar item key because the row
// for a branch that already has a PR keeps its `review:<id>` identity
// (see translateSelectKey in SidebarContext) — but both row kinds
// resolve the same `sessionNameForTerminal`.
//
// One request at a time, and a short-lived one: filing a new request
// replaces the old, and a request older than the TTL is dropped rather
// than consumed, so a request whose selection move never landed cannot
// pop the menu on a later, unrelated visit to that session. The window
// it needs is a couple of renders — the git work is already awaited
// before the request is filed.
//
// Pure module, no React — same subscribe shape as inactive-alerts.ts.

export const SESSION_MENU_REQUEST_TTL_MS = 10_000;

let pending: { sessionName: string; filedAt: number } | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of [...subscribers]) fn();
}

export function requestSessionMenu(
  sessionName: string,
  now: number = Date.now()
): void {
  pending = { sessionName, filedAt: now };
  notify();
}

/** The session a request is pending for, if any (expired or not). */
export function peekSessionMenuRequest(): string | null {
  return pending?.sessionName ?? null;
}

/**
 * Take the request for `sessionName`. Returns true when one was pending
 * and still fresh; either way a request for that session is cleared. A
 * request for another session is left for its own pane.
 */
export function consumeSessionMenuRequest(
  sessionName: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!pending || pending.sessionName !== sessionName) return false;
  const fresh = now - pending.filedAt <= SESSION_MENU_REQUEST_TTL_MS;
  pending = null;
  notify();
  return fresh;
}

export function subscribeSessionMenuRequest(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function __resetSessionMenuRequestForTests(): void {
  pending = null;
  subscribers.clear();
}
