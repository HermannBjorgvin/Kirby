// Covers the store layer the three useActivity hooks read through
// useSyncExternalStore. The rules that decide *when* a session is
// active or flashing live in activity.ts and are tested in
// activity.spec.ts; what is tested here is the part React depends on
// and that module can't provide on its own — a snapshot whose
// reference is stable exactly as long as the rendered state is.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionBackend } from '@kirby/terminal';
import {
  attach,
  noteSeen,
  __resetActivityForTests as resetActivity,
} from '@kirby/core';
import { ACTIVITY_IDLE_MS } from '@kirby/core';
import {
  activityStatusSnapshot,
  spinnerTicks,
  subscribeToTicker,
  __resetForTests as resetTicker,
} from './useActivity.js';

class MockPty {
  private dataCb: ((s: string) => void) | null = null;
  onData = vi.fn((cb: (s: string) => void) => {
    this.dataCb = cb;
  });
  offData = vi.fn(() => {
    this.dataCb = null;
  });
  // These sessions never exit; activity.attach still needs the pair.
  onExit = vi.fn();
  offExit = vi.fn();
  emit(data: string) {
    this.dataCb?.(data);
  }
  asPty(): SessionBackend {
    return this as unknown as SessionBackend;
  }
}

/** Keeps a session's active streak open for `ms` by emitting inside
 * every ACTIVITY_IDLE_MS window, so the streak length is `ms`. */
function keepActiveFor(pty: MockPty, ms: number): void {
  const step = ACTIVITY_IDLE_MS / 2;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    vi.advanceTimersByTime(step);
    pty.emit('xxxx');
  }
}

describe('activityStatusSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetActivity();
    resetTicker();
  });

  afterEach(() => {
    resetActivity();
    resetTicker();
    vi.useRealTimers();
  });

  it('hands back the identical object while the rendered state is unchanged', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());
    pty.emit('xxxx');

    const first = activityStatusSnapshot('s1');
    expect(first.active).toBe(true);

    // More output inside the idle window: the session stays active, so
    // the row has nothing to re-render for. Reference identity is what
    // tells useSyncExternalStore that.
    vi.advanceTimersByTime(500);
    pty.emit('xxxx');
    expect(activityStatusSnapshot('s1')).toBe(first);
    expect(activityStatusSnapshot('s1')).toBe(first);
  });

  it('hands back a new object when the session falls idle', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());
    pty.emit('xxxx');
    const active = activityStatusSnapshot('s1');

    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);
    const idle = activityStatusSnapshot('s1');

    expect(idle).not.toBe(active);
    expect(idle.active).toBe(false);
  });

  it('hands back a new object when only flashing changes', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());
    pty.emit('xxxx');
    keepActiveFor(pty, 4000); // streak longer than MIN_ACTIVE_MS

    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);
    const flashing = activityStatusSnapshot('s1');
    expect(flashing).toEqual({ active: false, flashing: true });

    // Acknowledging the output clears the flash. `active` is false on
    // both sides of this transition, so a guard that only compared
    // `active` would keep flashing the row forever.
    noteSeen('s1');
    const acked = activityStatusSnapshot('s1');
    expect(acked).not.toBe(flashing);
    expect(acked.flashing).toBe(false);
  });

  it('caches per session name', () => {
    const busy = new MockPty();
    const quiet = new MockPty();
    attach('busy', busy.asPty());
    attach('quiet', quiet.asPty());
    busy.emit('xxxx');

    const busySnapshot = activityStatusSnapshot('busy');
    expect(busySnapshot.active).toBe(true);
    expect(activityStatusSnapshot('quiet').active).toBe(false);

    // Reading another row must not evict this one — a single shared
    // cache slot would make two visible rows invalidate each other on
    // every tick.
    expect(activityStatusSnapshot('busy')).toBe(busySnapshot);
  });
});

describe('shared ticker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTicker();
  });

  afterEach(() => {
    resetTicker();
    vi.useRealTimers();
  });

  it('advances the spinner counter while subscribed and freezes once the last subscriber leaves', () => {
    const start = spinnerTicks();

    const unsubscribe = subscribeToTicker(() => undefined);
    vi.advanceTimersByTime(300);
    const running = spinnerTicks();
    expect(running).toBeGreaterThan(start);

    unsubscribe();
    vi.advanceTimersByTime(300);
    expect(spinnerTicks()).toBe(running);
  });

  it('notifies every subscriber on each tick', () => {
    const start = spinnerTicks();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeToTicker(a);
    const unsubB = subscribeToTicker(b);

    vi.advanceTimersByTime(300);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);
    // One ticker for both, not one per subscriber: the counter is
    // driven by ticks, not by notifications.
    expect(spinnerTicks() - start).toBe(3);

    unsubA();
    vi.advanceTimersByTime(100);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(4);

    unsubB();
  });
});
