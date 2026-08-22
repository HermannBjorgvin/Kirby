import { useEffect, useState } from 'react';
import { snapshot, type ActivitySnapshot } from '../activity.js';
import { FLASH_INTERVAL_MS } from '../activity-config.js';

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
// run N timers for N sessions.
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  if (timer == null) {
    timer = setInterval(() => {
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

export function __resetForTests(): void {
  subscribers.clear();
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

export function __timerActiveForTests(): boolean {
  return timer != null;
}

export function __subscriberCountForTests(): number {
  return subscribers.size;
}

// ── Status hook (slow-changing) ─────────────────────────────────

const QUIET: ActivitySnapshot = { active: false, flashing: false };

/**
 * Returns the slow-changing activity state for a row: whether the
 * spinner should be mounted and whether the title should be flashing.
 * Pure — side effects (like acknowledging a selected row with
 * `noteSeen`) belong in the consumer. Updates only when `active` or
 * `flashing` flips, so consuming it does NOT cause the row to
 * re-render every spinner tick.
 */
export function useActivityStatus(name: string): ActivitySnapshot {
  const [state, setState] = useState<ActivitySnapshot>(QUIET);

  useEffect(() => {
    const compute = () => {
      const next = snapshot(name);
      setState((prev) =>
        prev.active === next.active && prev.flashing === next.flashing
          ? prev
          : next
      );
    };
    compute();
    return subscribe(compute);
  }, [name]);

  return state;
}

// ── Flash-phase hook (used by the flashing title leaf) ─────────

/**
 * Returns 0 or 1, alternating every FLASH_INTERVAL_MS. Mount this only
 * inside the leaf title component that paints the flash — that way the
 * row above does not reconcile on every phase flip.
 *
 * Phase is re-evaluated on the shared ticker (TICK_MS), so flips can be
 * up to TICK_MS late; the setPhase equality guard means re-renders fire
 * only on actual phase transitions (~1.43Hz at FLASH_INTERVAL_MS=700).
 */
export function useFlashPhase(): number {
  const [phase, setPhase] = useState(
    () => Math.floor(Date.now() / FLASH_INTERVAL_MS) % 2
  );

  useEffect(() => {
    const tick = () => {
      const next = Math.floor(Date.now() / FLASH_INTERVAL_MS) % 2;
      setPhase((prev) => (prev === next ? prev : next));
    };
    return subscribe(tick);
  }, []);

  return phase;
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
 * Each row counts its own ticks (mounted-since), so spinners on
 * different rows may be out of phase. That's fine and avoids any
 * shared state.
 */
export function useSpinnerFrame(): SpinnerFrame {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  return {
    frame: tick % SPINNER_GLYPHS.length,
    colorIndex: Math.floor(tick / 2) % COLORS.length,
  };
}
