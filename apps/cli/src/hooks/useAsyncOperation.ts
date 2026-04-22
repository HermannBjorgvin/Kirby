import { useSyncExternalStore } from 'react';

export type OperationName =
  | 'sync'
  | 'rebase'
  | 'fetch-branches'
  | 'create-worktree'
  | 'delete'
  | 'check-delete'
  | 'start-session'
  | 'open-editor'
  | 'refresh-pr'
  | 'post-comment';

// ── Module-local store ───────────────────────────────────────────
//
// Replaces the old useState<Set> + useRef<Set> double-store pattern.
// The ref held the authoritative value; the state triggered renders
// but lagged the ref by a tick. Now the mutable set IS the authority;
// consumers read it through useSyncExternalStore.
//
// Copy-on-write on every mutation so the snapshot reference changes
// exactly when the contents change — React detects this via identity
// and re-renders subscribers.

let inFlight = new Set<OperationName>();
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ReadonlySet<OperationName> {
  return inFlight;
}

function notify(): void {
  for (const cb of listeners) cb();
}

/**
 * Serialized async operation runner. If an operation with `name` is
 * already in flight, the call returns immediately without starting a
 * second one. The cleanup runs in a `finally` so thrown errors still
 * remove the op from the in-flight set.
 */
export async function run(
  name: OperationName,
  fn: () => Promise<void>
): Promise<void> {
  if (inFlight.has(name)) return;
  inFlight = new Set(inFlight);
  inFlight.add(name);
  notify();
  try {
    await fn();
  } finally {
    inFlight = new Set(inFlight);
    inFlight.delete(name);
    notify();
  }
}

/** Stable function — always reads the latest module-local set. */
export function isRunning(name: OperationName): boolean {
  return inFlight.has(name);
}

/** Test-only: drop all in-flight operations and notify subscribers. */
export function __resetAsyncOperationsForTest(): void {
  inFlight = new Set();
  notify();
}

// ── Hook ─────────────────────────────────────────────────────────

export function useAsyncOperation() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  // Cast to `Set` for the public shape — consumers already treat it
  // as read-only in practice, but the existing type signature promises
  // `Set<OperationName>`. The snapshot is copy-on-write so writing to
  // it would be a bug anyway.
  return { run, isRunning, inFlight: snapshot as Set<OperationName> };
}
