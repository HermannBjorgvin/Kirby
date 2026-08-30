import { useCallback, useState, useSyncExternalStore } from 'react';
import { snapshot, type ActivitySnapshot } from '@kirby/core';
import { FLASH_INTERVAL_MS } from '@kirby/core';

const TICK_MS = 100;

export const SPINNER_GLYPHS = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
export const COLORS = [
  'red',
  'yellow',
  'green',
  'cyan',
  'blue',
  'magenta',
] as const;

// One shared ticker drives every visible row's animation so we don't
// run N timers for N sessions. It is the store all three hooks below
// subscribe to via useSyncExternalStore; the ticker is what tells React
// "something may have changed, re-read your snapshot".
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
// Monotonic count of elapsed ticks. Never reset, so a `base` captured
// by a mounted useSpinnerFrame can't go stale underneath it.
let ticks = 0;

// `snapshot()` builds a fresh object on every call for a session that
// is active, flashing or exited, and useSyncExternalStore compares
// snapshots by identity — handing it that object directly would render
// on every tick and, worse, never settle. So each name gets a cached
// snapshot that is *kept* while `active` and `flashing` are unchanged,
// which is the same equality guard the hook applied before and the
// property React relies on to stop re-rendering.
const statusCache = new Map<string, ActivitySnapshot>();

/**
 * `subscribe` for useSyncExternalStore: registers `cb` on the shared
 * ticker and starts it if it wasn't already running. The returned
 * unsubscribe stops the ticker once the last subscriber leaves.
 */
export function subscribeToTicker(cb: () => void): () => void {
  subscribers.add(cb);
  if (timer == null) {
    timer = setInterval(() => {
      ticks += 1;
      // Snapshot before iterating: a callback may synchronously
      // subscribe/unsubscribe others (mount/unmount during commit).
      for (const fn of [...subscribers]) fn();
    }, TICK_MS);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * `getSnapshot` for useSpinnerFrame: the number of ticks the shared
 * ticker has run for. Advances only while the ticker is running, i.e.
 * only while at least one animation is on screen.
 */
export function spinnerTicks(): number {
  return ticks;
}

export function __resetForTests(): void {
  subscribers.clear();
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  statusCache.clear();
}

export function __timerActiveForTests(): boolean {
  return timer != null;
}

export function __subscriberCountForTests(): number {
  return subscribers.size;
}

// ── Status hook (slow-changing) ─────────────────────────────────

/**
 * Reads the current snapshot for `name`, reusing the previous object
 * whenever the two fields the UI cares about are unchanged. Exported
 * for tests: the stability of this reference is what keeps
 * useSyncExternalStore from looping.
 */
export function activityStatusSnapshot(name: string): ActivitySnapshot {
  const next = snapshot(name);
  const prev = statusCache.get(name);
  if (
    prev !== undefined &&
    prev.active === next.active &&
    prev.flashing === next.flashing
  ) {
    return prev;
  }
  statusCache.set(name, next);
  return next;
}

/**
 * Returns the slow-changing activity state for a row: whether the
 * spinner should be mounted and whether the title should be flashing.
 * Pure — side effects (like acknowledging a selected row with
 * `noteSeen`) belong in the consumer. Updates only when `active` or
 * `flashing` flips, so consuming it does NOT cause the row to
 * re-render every spinner tick.
 */
export function useActivityStatus(name: string): ActivitySnapshot {
  const getSnapshot = useCallback(() => activityStatusSnapshot(name), [name]);
  return useSyncExternalStore(subscribeToTicker, getSnapshot);
}

// ── Flash-phase hook (used by the flashing title leaf) ─────────

/** `getSnapshot` for useFlashPhase: 0 or 1 by wall-clock time. */
function flashPhase(): number {
  return Math.floor(Date.now() / FLASH_INTERVAL_MS) % 2;
}

/**
 * Returns 0 or 1, alternating every FLASH_INTERVAL_MS. Mount this only
 * inside the leaf title component that paints the flash — that way the
 * row above does not reconcile on every phase flip.
 *
 * Phase is re-evaluated on the shared ticker (TICK_MS), so flips can be
 * up to TICK_MS late; the snapshot is a number, so re-renders fire only
 * on actual phase transitions (~1.43Hz at FLASH_INTERVAL_MS=700).
 */
export function useFlashPhase(): number {
  return useSyncExternalStore(subscribeToTicker, flashPhase);
}

// ── Spinner-frame hook (fast-changing) ──────────────────────────

export interface SpinnerFrame {
  frame: number;
  colorIndex: number;
}

/**
 * Returns the per-tick spinner glyph + color index. The spinner is
 * supposed to advance every tick, so there's no equality guard — mount
 * this hook only inside the leaf component that paints the spinner, so
 * the row above doesn't reconcile on every tick.
 *
 * Each row counts its own ticks (mounted-since) by subtracting the
 * shared counter's value at mount, so spinners on different rows may be
 * out of phase. That's fine, and it keeps the shared state to a single
 * integer.
 */
export function useSpinnerFrame(): SpinnerFrame {
  const [base] = useState(spinnerTicks);
  const tick = useSyncExternalStore(subscribeToTicker, spinnerTicks) - base;
  return {
    frame: tick % SPINNER_GLYPHS.length,
    colorIndex: Math.floor(tick / 2) % COLORS.length,
  };
}
