import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MIN_ACTIVE_MS } from './activity-config.js';

// Capture every PtySession / TerminalEmulator the registry constructs so
// a test can drive the exit callback and inspect disposal.
const { ptys, emus } = vi.hoisted(() => ({
  ptys: [] as MockPty[],
  emus: [] as MockEmu[],
}));

class MockPty {
  dataCbs: ((s: string) => void)[] = [];
  exitCbs: ((c: number) => void)[] = [];
  write = vi.fn();
  resize = vi.fn();
  dispose = vi.fn();
  onData = (cb: (s: string) => void) => this.dataCbs.push(cb);
  offData = (cb: (s: string) => void) => {
    this.dataCbs = this.dataCbs.filter((f) => f !== cb);
  };
  onExit = (cb: (c: number) => void) => this.exitCbs.push(cb);
  offExit = (cb: (c: number) => void) => {
    this.exitCbs = this.exitCbs.filter((f) => f !== cb);
  };
  emit(s: string) {
    for (const cb of [...this.dataCbs]) cb(s);
  }
  triggerExit(code = 0) {
    for (const cb of [...this.exitCbs]) cb(code);
  }
}

class MockEmu {
  mouseTrackingMode = 'none';
  maxScrollback = 0;
  write = vi.fn();
  render = vi.fn(() => '');
  resize = vi.fn();
  onRender = vi.fn();
  offRender = vi.fn();
  dispose = vi.fn();
}

vi.mock('@kirby/terminal', () => ({
  PtySession: class {
    constructor() {
      const m = new MockPty();
      ptys.push(m);
      return m as unknown as object;
    }
  },
  TerminalEmulator: class {
    constructor() {
      const m = new MockEmu();
      emus.push(m);
      return m as unknown as object;
    }
  },
}));

// Import after the mock is registered.
import * as activity from './activity.js';
import {
  spawnSession,
  getSession,
  hasSession,
  isSessionAlive,
  killSession,
} from './pty-registry.js';

const NAMES = ['s1', 's2'];

describe('pty-registry — self-exit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (const n of NAMES) killSession(n); // clear registry from prior test
    ptys.length = 0;
    emus.length = 0;
    activity.__resetForTests();
  });

  afterEach(() => {
    for (const n of NAMES) killSession(n);
    activity.__resetForTests();
    vi.useRealTimers();
  });

  it('keeps the entry reachable (present but not alive) after self-exit', () => {
    spawnSession('s1', 'cmd', [], 80, 24, '/tmp');
    ptys[0].triggerExit(3);

    // Present, so its final output frame + exit code stay viewable...
    expect(hasSession('s1')).toBe(true);
    expect(getSession('s1')?.exited).toBe(true);
    expect(getSession('s1')?.exitCode).toBe(3);
    // ...but no longer "alive", so the running indicator goes gray.
    expect(isSessionAlive('s1')).toBe(false);
  });

  it('does not dispose the emulator on exit, but killSession still can', () => {
    spawnSession('s1', 'cmd', [], 80, 24, '/tmp');
    const emu = emus[0];

    ptys[0].triggerExit(0);
    expect(emu.dispose).not.toHaveBeenCalled();

    // The entry survived, so killSession can still reach and dispose it.
    killSession('s1');
    expect(emu.dispose).toHaveBeenCalledTimes(1);
  });

  it('leaves activity tracking intact so the row can still flash', () => {
    spawnSession('s1', 'cmd', [], 80, 24, '/tmp');

    // Qualifying active streak, never seen by the user.
    ptys[0].emit('xxxx');
    const ticks = Math.ceil(MIN_ACTIVE_MS / 200) + 1;
    for (let i = 0; i < ticks; i++) {
      vi.advanceTimersByTime(200);
      ptys[0].emit('xxxx');
    }

    ptys[0].triggerExit(0);
    // Detaching activity here (the old bug) would return QUIET instead.
    expect(activity.snapshot('s1')).toMatchObject({
      active: false,
      flashing: true,
      exited: true,
    });
  });
});
