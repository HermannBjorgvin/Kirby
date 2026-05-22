import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Capture the onExit callback registered by spawnSession
let capturedOnExit: ((code: number, signal?: number) => void) | null = null;

vi.mock('@kirby/terminal', () => ({
  PtySession: class MockPtySession {
    onData = vi.fn();
    onExit = vi.fn((cb: (code: number, signal?: number) => void) => {
      capturedOnExit = cb;
    });
    dispose = vi.fn();
    resize = vi.fn();
    write = vi.fn();
    pid = 1234;
    cols = 80;
    rows = 24;
  },
  TerminalEmulator: class MockTerminalEmulator {
    write = vi.fn();
    render = vi.fn(() => '');
    resize = vi.fn();
    dispose = vi.fn();
    onRender = vi.fn();
    offRender = vi.fn();
  },
}));
vi.mock('./activity.js', () => ({
  attach: vi.fn(),
  detach: vi.fn(),
}));
vi.mock('./inactive-alerts.js', () => ({
  remove: vi.fn(),
}));

import {
  spawnSession,
  getSession,
  hasSession,
  killSession,
  onSessionExit,
  offSessionExit,
} from './pty-registry.js';

beforeEach(() => {
  capturedOnExit = null;
});

afterEach(() => {
  killSession('test-session');
});

describe('pty-registry', () => {
  describe('hasSession reflects process exit', () => {
    it('returns true for a running session', () => {
      spawnSession('test-session', '/bin/sh', ['-c', 'true'], 80, 24, '/tmp');
      expect(hasSession('test-session')).toBe(true);
    });

    it('returns false after the process exits on its own', () => {
      spawnSession('test-session', '/bin/sh', ['-c', 'true'], 80, 24, '/tmp');
      expect(hasSession('test-session')).toBe(true);

      // Simulate the process exiting on its own
      capturedOnExit!(0);

      expect(hasSession('test-session')).toBe(false);
    });

    it('getSession still returns the entry after exit (for terminal rendering)', () => {
      spawnSession('test-session', '/bin/sh', ['-c', 'true'], 80, 24, '/tmp');
      capturedOnExit!(1);

      const entry = getSession('test-session');
      expect(entry).toBeDefined();
      expect(entry!.exited).toBe(true);
      expect(entry!.exitCode).toBe(1);
    });
  });

  describe('onSessionExit listener', () => {
    it('fires when a process exits on its own', () => {
      const listener = vi.fn();
      onSessionExit(listener);

      spawnSession('test-session', '/bin/sh', ['-c', 'true'], 80, 24, '/tmp');
      capturedOnExit!(0);

      expect(listener).toHaveBeenCalledWith('test-session', 0);
      offSessionExit(listener);
    });

    it('does not fire after being removed with offSessionExit', () => {
      const listener = vi.fn();
      onSessionExit(listener);
      offSessionExit(listener);

      spawnSession('test-session', '/bin/sh', ['-c', 'true'], 80, 24, '/tmp');
      capturedOnExit!(0);

      expect(listener).not.toHaveBeenCalled();
    });

    it('fires for multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      onSessionExit(listener1);
      onSessionExit(listener2);

      spawnSession('test-session', '/bin/sh', ['-c', 'true'], 80, 24, '/tmp');
      capturedOnExit!(42);

      expect(listener1).toHaveBeenCalledWith('test-session', 42);
      expect(listener2).toHaveBeenCalledWith('test-session', 42);

      offSessionExit(listener1);
      offSessionExit(listener2);
    });
  });
});
