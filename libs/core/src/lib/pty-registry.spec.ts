import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionBackend } from '@n10/terminal';
import { MIN_ACTIVE_MS } from './activity-config.js';

// Capture every session backend / TerminalEmulator the registry constructs
// so a test can drive the exit callback and inspect disposal.
const { ptys, emus } = vi.hoisted(() => ({
  ptys: [] as MockPty[],
  emus: [] as MockEmu[],
}));

class MockPty {
  connectionState: 'connected' | 'reconnecting' | 'failed' = 'connected';
  dataCbs: ((s: string) => void)[] = [];
  exitCbs: ((c: number) => void)[] = [];
  write = vi.fn();
  resize = vi.fn();
  dispose = vi.fn();
  kill = vi.fn();
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
  frame = '';
  renders = new Set<() => void>();
  write = vi.fn(async (data: string) => {
    await Promise.resolve();
    this.frame += data;
    for (const callback of this.renders) callback();
  });
  render = vi.fn(() => this.frame);
  resize = vi.fn();
  onRender = vi.fn((callback: () => void) => this.renders.add(callback));
  offRender = vi.fn((callback: () => void) => this.renders.delete(callback));
  dispose = vi.fn();
}

vi.mock('@n10/terminal', () => ({
  TerminalEmulator: function MockTerminalEmulator() {
    const m = new MockEmu();
    emus.push(m);
    return m as unknown as object;
  },
}));

// Import after the mock is registered.
import * as activity from './activity.js';
import {
  spawnSession as registerSession,
  getSession,
  hasSession,
  hasSessionConnection,
  hasAnySession,
  isSessionAlive,
  killAll,
  killSession,
  releaseExitedSession,
  detachSession,
} from './pty-registry.js';

const NAMES = ['s1', 's2'];
function spawnSession(name: string) {
  const pty = new MockPty();
  ptys.push(pty);
  return registerSession(name, pty as unknown as SessionBackend, 80, 24);
}

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
    spawnSession('s1');
    ptys[0].triggerExit(3);

    // Present, so its final output frame + exit code stay viewable...
    expect(hasSession('s1')).toBe(true);
    expect(getSession('s1')?.exited).toBe(true);
    expect(getSession('s1')?.exitCode).toBe(3);
    // ...but no longer "alive", so the running indicator goes gray.
    expect(isSessionAlive('s1')).toBe(false);
  });

  it('allows rediscovery after connection retries fail without claiming the agent exited', () => {
    spawnSession('s1');
    ptys[0].connectionState = 'failed';
    expect(isSessionAlive('s1')).toBe(true);
    expect(hasSessionConnection('s1')).toBe(false);
    expect(getSession('s1')?.exited).toBe(false);
    expect(hasSession('s1')).toBe(true);
  });

  it('detaches a missing target without killing any replacement session', () => {
    spawnSession('s1');
    detachSession('s1');
    expect(ptys[0].dispose).toHaveBeenCalledOnce();
    expect(ptys[0].kill).not.toHaveBeenCalled();
    expect(hasSession('s1')).toBe(false);
  });

  it('does not dispose the emulator on exit, but killSession still can', () => {
    spawnSession('s1');
    const emu = emus[0];

    ptys[0].triggerExit(0);
    expect(emu.dispose).not.toHaveBeenCalled();

    // The entry survived, so killSession can still reach and dispose it.
    killSession('s1');
    expect(emu.dispose).toHaveBeenCalledTimes(1);
  });

  it('leaves activity tracking intact so the row can still flash', async () => {
    spawnSession('s1');

    // Qualifying active streak, never seen by the user.
    ptys[0].emit('xxxx');
    await Promise.resolve();
    const ticks = Math.ceil(MIN_ACTIVE_MS / 200) + 1;
    for (let i = 0; i < ticks; i++) {
      vi.advanceTimersByTime(200);
      ptys[0].emit('xxxx');
      await Promise.resolve();
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

// The backend interface splits teardown in two: dispose() releases local
// resources only, kill() terminates the underlying session. For the
// low-level PTY transport these can coincide, so these tests are
// the only thing standing between a wrong call here and a *silent*
// regression for persistent backends — under tmux, dispose() leaves the
// session running and kill() destroys it. Swapping either call would
// still pass every other test in the suite.
describe('pty-registry — teardown contract', () => {
  beforeEach(() => {
    for (const n of NAMES) killSession(n);
    ptys.length = 0;
    emus.length = 0;
    activity.__resetForTests();
  });

  afterEach(() => {
    for (const n of NAMES) killSession(n);
    activity.__resetForTests();
  });

  it('killSession calls kill(), so a tmux session is destroyed not orphaned', () => {
    spawnSession('s1');
    const pty = ptys[0]!;

    killSession('s1');

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(pty.dispose).not.toHaveBeenCalled();
    expect(hasSession('s1')).toBe(false);
  });

  it('killAll calls dispose(), so tmux sessions survive a n10 restart', () => {
    spawnSession('s1');
    spawnSession('s2');
    const spawned = [...ptys];
    expect(spawned).toHaveLength(2);

    killAll();

    for (const pty of spawned) {
      expect(pty.dispose).toHaveBeenCalledTimes(1);
      expect(pty.kill).not.toHaveBeenCalled();
    }
    expect(hasAnySession()).toBe(false);
  });

  // A terminal tab closes itself when its process ends, so nothing is
  // left to view the tombstone through; the entry is dropped without a
  // kill, because on tmux `kill()` would reach the session — and the
  // client can exit while the session lives on (the user detached from
  // inside tmux), which must not become a kill-session.
  describe('releaseExitedSession', () => {
    it('drops an exited entry and its emulator without calling kill()', () => {
      spawnSession('s1');
      const pty = ptys[0]!;
      const emu = emus[0]!;
      pty.triggerExit(0);

      releaseExitedSession('s1');

      expect(hasSession('s1')).toBe(false);
      expect(emu.dispose).toHaveBeenCalledTimes(1);
      expect(pty.kill).not.toHaveBeenCalled();
    });

    it('leaves a live session untouched', () => {
      spawnSession('s1');
      const emu = emus[0]!;

      releaseExitedSession('s1');

      expect(isSessionAlive('s1')).toBe(true);
      expect(emu.dispose).not.toHaveBeenCalled();
    });
  });

  it('respawning the same name disposes the old entry rather than killing it', () => {
    spawnSession('s1');
    const first = ptys[0]!;

    spawnSession('s1');

    // dispose, not kill: on tmux the `-A` flag then reattaches to the
    // still-live session instead of starting a fresh one.
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(first.kill).not.toHaveBeenCalled();
  });
});
