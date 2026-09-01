import { useSyncExternalStore } from 'react';

// A request to open a branch's session menu, from somewhere other than
// the tab that owns the menu: the sidebar (Enter, double-click, the
// row's "Launch agent…") and the command palette (checking out a
// branch lands the user in the new worktree's menu, like the TUI).
//
// Keyed by branch rather than tab or item key: a worktree tab is
// re-keyed from `branch:x` to `pr:n` once its pull request is known,
// and the item behind a freshly created worktree does not exist yet
// when the request is filed — the branch is the one name everything
// agrees on throughout.
//
// One request at a time. Filing a new one replaces the old: the
// selection it accompanies is the user's newest intent, and a stale
// request must not pop a menu on a later, unrelated tab.

let pending: string | null = null;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of [...subscribers]) fn();
}

export function requestLaunchMenu(branch: string): void {
  pending = branch;
  notify();
}

/** Drop the request for `branch`; a request for another branch stays. */
export function clearLaunchMenuRequest(branch: string): void {
  if (pending !== branch) return;
  pending = null;
  notify();
}

export function pendingLaunchMenu(): string | null {
  return pending;
}

export function subscribeLaunchMenu(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** True while a menu is requested for `branch`. */
export function useLaunchMenuRequested(branch: string): boolean {
  return useSyncExternalStore(subscribeLaunchMenu, () => pending === branch);
}

/**
 * Whether a tab shows its session menu: opened from the tab itself, or
 * requested from outside — honored once the item exists and only while
 * its agent is not running (a live agent has nothing to choose).
 */
export function launchMenuOpen(s: {
  own: boolean;
  requested: boolean;
  hasItem: boolean;
  running: boolean;
}): boolean {
  return s.own || (s.requested && s.hasItem && !s.running);
}

export function __resetLaunchMenuRequestForTests(): void {
  pending = null;
  subscribers.clear();
}
