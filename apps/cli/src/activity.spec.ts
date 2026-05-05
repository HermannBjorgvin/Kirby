import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionBackend } from '@kirby/terminal';
import {
  __resetForTests,
  attach,
  detach,
  noteInput,
  noteSeen,
  snapshot,
} from './activity.js';
import {
  ACTIVITY_IDLE_MS,
  INPUT_ECHO_MS,
  MIN_ACTIVE_MS,
} from './activity-config.js';

class MockPty {
  private dataCb: ((s: string) => void) | null = null;
  private exitCb: ((c: number) => void) | null = null;
  onData = vi.fn((cb: (s: string) => void) => {
    this.dataCb = cb;
  });
  offData = vi.fn(() => {
    this.dataCb = null;
  });
  onExit = vi.fn((cb: (c: number) => void) => {
    this.exitCb = cb;
  });
  offExit = vi.fn(() => {
    this.exitCb = null;
  });
  emit(data: string) {
    this.dataCb?.(data);
  }
  exit(code = 0) {
    this.exitCb?.(code);
  }
  asPty(): SessionBackend {
    return this as unknown as SessionBackend;
  }
}

describe('activity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    __resetForTests();
  });

  afterEach(() => {
    __resetForTests();
    vi.useRealTimers();
  });

  it('reads as QUIET immediately after attach', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());
    expect(snapshot('s1')).toEqual({ active: false, flashing: false });
  });

  it('marks the session active after a real data burst', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    pty.emit('xxxx');
    expect(snapshot('s1').active).toBe(true);

    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);
    expect(snapshot('s1').active).toBe(false);
  });

  it('suppresses output that lands inside the input-echo window', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    noteInput('s1');
    vi.advanceTimersByTime(INPUT_ECHO_MS - 1);
    pty.emit('xxxx');
    expect(snapshot('s1').active).toBe(false);
  });

  it('counts output once the echo window has expired', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    noteInput('s1');
    vi.advanceTimersByTime(INPUT_ECHO_MS + 1);
    pty.emit('xxxx');
    expect(snapshot('s1').active).toBe(true);
  });

  it('ignores tiny payloads below the byte threshold', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    pty.emit('a');
    expect(snapshot('s1').active).toBe(false);
  });

  it('flashes after a long-enough streak goes idle without being seen', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    // Drive a continuous streak that lasts at least MIN_ACTIVE_MS.
    pty.emit('xxxx');
    const ticks = Math.ceil(MIN_ACTIVE_MS / 200) + 1;
    for (let i = 0; i < ticks; i++) {
      vi.advanceTimersByTime(200);
      pty.emit('xxxx');
    }

    // Let it lapse into idle.
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);

    expect(snapshot('s1')).toEqual({ active: false, flashing: true });

    noteSeen('s1');
    expect(snapshot('s1').flashing).toBe(false);
  });

  it('does not flash for short streaks', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    pty.emit('xxxx');
    vi.advanceTimersByTime(200);
    pty.emit('xxxx');
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);

    expect(snapshot('s1').flashing).toBe(false);
  });

  it('detach unsubscribes from the PTY and makes future calls no-ops', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());
    expect(pty.onData).toHaveBeenCalledTimes(1);
    expect(pty.onExit).toHaveBeenCalledTimes(1);

    detach('s1');
    expect(pty.offData).toHaveBeenCalledTimes(1);
    expect(pty.offExit).toHaveBeenCalledTimes(1);

    // No throw, snapshot returns QUIET.
    noteInput('s1');
    noteSeen('s1');
    expect(snapshot('s1')).toEqual({ active: false, flashing: false });
  });

  it('treats exited sessions as inactive even if recent data arrived', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    pty.emit('xxxx');
    expect(snapshot('s1').active).toBe(true);

    pty.exit(0);
    expect(snapshot('s1').active).toBe(false);
  });

  it('still flashes an exited session whose streak qualified and was never seen', () => {
    const pty = new MockPty();
    attach('s1', pty.asPty());

    // Qualifying streak.
    pty.emit('xxxx');
    const ticks = Math.ceil(MIN_ACTIVE_MS / 200) + 1;
    for (let i = 0; i < ticks; i++) {
      vi.advanceTimersByTime(200);
      pty.emit('xxxx');
    }

    pty.exit(0);
    expect(snapshot('s1')).toEqual({ active: false, flashing: true });

    noteSeen('s1');
    expect(snapshot('s1').flashing).toBe(false);
  });

  it('re-attach with the same name clears flashing carried over from the previous PTY', () => {
    const pty1 = new MockPty();
    attach('s1', pty1.asPty());

    // Build a qualifying streak on pty1 and let it lapse — the session
    // is now flashing.
    pty1.emit('xxxx');
    const ticks = Math.ceil(MIN_ACTIVE_MS / 200) + 1;
    for (let i = 0; i < ticks; i++) {
      vi.advanceTimersByTime(200);
      pty1.emit('xxxx');
    }
    vi.advanceTimersByTime(ACTIVITY_IDLE_MS + 1);
    expect(snapshot('s1').flashing).toBe(true);

    // Respawn the session with the same name: flashing state should not
    // carry over, since the new process has produced no output yet.
    const pty2 = new MockPty();
    attach('s1', pty2.asPty());
    expect(snapshot('s1')).toEqual({ active: false, flashing: false });
  });

  it('attach replaces an existing entry and disposes the old PTY listeners', () => {
    const pty1 = new MockPty();
    attach('s1', pty1.asPty());

    const pty2 = new MockPty();
    attach('s1', pty2.asPty());

    expect(pty1.offData).toHaveBeenCalledTimes(1);
    expect(pty1.offExit).toHaveBeenCalledTimes(1);

    // Old PTY no longer drives the activity for s1.
    pty1.emit('xxxx');
    expect(snapshot('s1').active).toBe(false);

    pty2.emit('xxxx');
    expect(snapshot('s1').active).toBe(true);
  });
});
