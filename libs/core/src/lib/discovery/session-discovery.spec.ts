import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorktreeInfo } from '@kirby/worktree-manager';
import type { DiscoveredWorktree } from './discovery-model.js';

const {
  listWorktreesMock,
  listPersistedMock,
  isSessionAliveMock,
  watchMock,
  basePathMock,
} = vi.hoisted(() => ({
  listWorktreesMock: vi.fn<() => Promise<WorktreeInfo[]>>(),
  listPersistedMock: vi.fn<() => Set<string>>(),
  isSessionAliveMock: vi.fn<(name: string) => boolean>(),
  watchMock: vi.fn(),
  basePathMock: vi.fn<() => string>(),
}));

vi.mock('node:fs', () => ({
  watch: (...args: unknown[]) => watchMock(...args),
}));
vi.mock('@kirby/logger', () => ({
  log: () => undefined,
  logError: () => undefined,
}));
vi.mock('@kirby/worktree-manager', () => ({
  listWorktrees: () => listWorktreesMock(),
  worktreeSessionName: (wt: WorktreeInfo) => wt.branch,
  worktreesBasePath: () => basePathMock(),
}));
vi.mock('../pty-registry.js', () => ({
  isSessionAlive: (name: string) => isSessionAliveMock(name),
}));
vi.mock('../session-backend.js', () => ({
  listPersistedTmuxSessions: () => listPersistedMock(),
}));

import { startSessionDiscovery } from './session-discovery.js';

function worktrees(...branches: string[]): WorktreeInfo[] {
  return branches.map((branch) => ({
    branch,
    path: `/repo/.claude/worktrees/${branch}`,
    bare: false,
  }));
}

const getConfig = () => ({ terminalBackend: 'tmux' as const });

/** A watcher stand-in that hands back the change callback so a test can
 *  fire it the way the filesystem would. */
function captureWatcher() {
  const handle = { close: vi.fn(), on: vi.fn() };
  let fire: (() => void) | undefined;
  watchMock.mockImplementation(
    (_path: unknown, _opts: unknown, cb: () => void) => {
      fire = cb;
      return handle;
    }
  );
  return { handle, trigger: () => fire?.() };
}

let running: { stop(): void } | null = null;
/** Stands in for the PTY registry: the default `adopt` puts a name in
 *  here, which is what a real attach does by spawning into it. Without
 *  that, every scan would keep re-offering a session it just attached
 *  to — and the tests would be asserting against a world that cannot
 *  happen. */
let alive: Set<string>;

beforeEach(() => {
  vi.useFakeTimers();
  alive = new Set();
  listWorktreesMock.mockReset().mockResolvedValue([]);
  listPersistedMock.mockReset().mockReturnValue(new Set());
  isSessionAliveMock.mockReset().mockImplementation((name) => alive.has(name));
  basePathMock.mockReset().mockReturnValue('/repo/.claude/worktrees');
  watchMock.mockReset().mockReturnValue({ close: vi.fn(), on: vi.fn() });
});

afterEach(() => {
  running?.stop();
  running = null;
  vi.useRealTimers();
});

function start(over: Partial<Parameters<typeof startSessionDiscovery>[0]> = {}) {
  const adopt = vi.fn<(wt: DiscoveredWorktree) => void | Promise<void>>(
    (wt) => {
      alive.add(wt.name);
    }
  );
  const onChanged = vi.fn();
  const discovery = startSessionDiscovery({
    getConfig,
    adopt,
    onChanged,
    intervalMs: 1000,
    ...over,
  });
  running = discovery;
  return { discovery, adopt, onChanged };
}

describe('startSessionDiscovery', () => {
  it('attaches to a session that appears while running', async () => {
    const { discovery, adopt, onChanged } = start();
    await discovery.scanNow();
    expect(adopt).not.toHaveBeenCalled();

    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set(['feature-a']));
    await discovery.scanNow();

    expect(adopt).toHaveBeenCalledTimes(1);
    expect(adopt.mock.calls[0]![0]).toEqual({
      name: 'feature-a',
      branch: 'feature-a',
      path: '/repo/.claude/worktrees/feature-a',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('attaches on the first scan to a session that outlived the last run', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set(['feature-a']));
    const { discovery, adopt } = start();
    await discovery.scanNow();
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  // The registry entry is live, so attaching again would dispose the
  // PTY the user is looking at.
  it('never attaches twice to the same live session', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set(['feature-a']));
    const { discovery, adopt } = start();
    await discovery.scanNow();
    await discovery.scanNow();
    await discovery.scanNow();
    expect(adopt).toHaveBeenCalledTimes(1);
  });

  it('announces a new worktree that has no session behind it', async () => {
    const { discovery, onChanged, adopt } = start();
    await discovery.scanNow();
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    await discovery.scanNow();
    expect(adopt).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged.mock.calls[0]![0]).toMatchObject({
      appeared: [expect.objectContaining({ name: 'feature-a' })],
    });
  });

  it('announces a session killed from outside', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set(['feature-a']));
    const { discovery, onChanged } = start();
    await discovery.scanNow();
    onChanged.mockClear();

    listPersistedMock.mockReturnValue(new Set());
    await discovery.scanNow();
    expect(onChanged.mock.calls[0]![0]).toMatchObject({ ended: ['feature-a'] });
  });

  it('says nothing when nothing changed', async () => {
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    const { discovery, onChanged } = start();
    await discovery.scanNow();
    await discovery.scanNow();
    await discovery.scanNow();
    expect(onChanged).not.toHaveBeenCalled();
  });

  // Announcing first would have the shell re-read the registry before
  // the attach had put anything in it, and report the session as idle.
  it('announces only after the attach has finished', async () => {
    const order: string[] = [];
    listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
    listPersistedMock.mockReturnValue(new Set(['feature-a']));
    const { discovery } = start({
      adopt: async (wt) => {
        await Promise.resolve();
        alive.add(wt.name);
        order.push('adopt');
      },
      onChanged: () => order.push('changed'),
    });
    await discovery.scanNow();
    expect(order).toEqual(['adopt', 'changed']);
  });

  describe('a failing attach', () => {
    it('is not retried while the same session is still there', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set(['feature-a']));
      const adopt = vi.fn().mockRejectedValue(new Error('no worktree'));
      const { discovery } = start({ adopt });
      await discovery.scanNow();
      await discovery.scanNow();
      await discovery.scanNow();
      expect(adopt).toHaveBeenCalledTimes(1);
    });

    it('is tried again once tmux has dropped that session', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set(['feature-a']));
      const adopt = vi.fn().mockRejectedValue(new Error('no worktree'));
      const { discovery } = start({ adopt });
      await discovery.scanNow();

      listPersistedMock.mockReturnValue(new Set());
      await discovery.scanNow();
      listPersistedMock.mockReturnValue(new Set(['feature-a']));
      await discovery.scanNow();
      expect(adopt).toHaveBeenCalledTimes(2);
    });

    it('does not take the process down', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set(['feature-a']));
      const { discovery, onChanged } = start({
        adopt: () => {
          throw new Error('boom');
        },
      });
      await expect(discovery.scanNow()).resolves.toBeUndefined();
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it('survives git failing', async () => {
    listWorktreesMock.mockRejectedValue(new Error('git exploded'));
    const { discovery, onChanged } = start();
    await expect(discovery.scanNow()).resolves.toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
  });

  describe('scheduling', () => {
    it('scans on the interval', async () => {
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(3000);
      expect(listWorktreesMock.mock.calls.length).toBeGreaterThan(before);
    });

    it('stops scanning after stop()', async () => {
      const { discovery } = start();
      await discovery.scanNow();
      discovery.stop();
      const before = listWorktreesMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(listWorktreesMock.mock.calls.length).toBe(before);
    });

    // Two overlapping scans would diff against each other's `previous`
    // and could offer the same session to `adopt` twice.
    it('never runs two scans at once', async () => {
      let active = 0;
      let peak = 0;
      listWorktreesMock.mockImplementation(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return [];
      });
      const { discovery } = start();
      await Promise.all([
        discovery.scanNow(),
        discovery.scanNow(),
        discovery.scanNow(),
      ]);
      expect(peak).toBe(1);
    });

    it('abandons a scan when the repo is no longer current', async () => {
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      listPersistedMock.mockReturnValue(new Set(['feature-a']));
      const { discovery, adopt, onChanged } = start({
        isCurrent: () => false,
      });
      await discovery.scanNow();
      expect(adopt).not.toHaveBeenCalled();
      expect(onChanged).not.toHaveBeenCalled();
    });
  });

  describe('the worktrees directory watch', () => {
    it('watches the resolver base, one directory, not recursively', () => {
      start();
      expect(watchMock).toHaveBeenCalledWith(
        '/repo/.claude/worktrees',
        expect.objectContaining({ recursive: false, persistent: false }),
        expect.any(Function)
      );
    });

    it('scans off-cycle when the directory changes', async () => {
      const watcher = captureWatcher();
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;

      watcher.trigger();
      await vi.advanceTimersByTimeAsync(500);
      expect(listWorktreesMock.mock.calls.length).toBeGreaterThan(before);
    });

    it('coalesces a burst of events into one scan', async () => {
      const watcher = captureWatcher();
      const { discovery } = start();
      await discovery.scanNow();
      const before = listWorktreesMock.mock.calls.length;

      for (let i = 0; i < 10; i++) watcher.trigger();
      await vi.advanceTimersByTimeAsync(500);
      expect(listWorktreesMock.mock.calls.length).toBe(before + 1);
    });

    it('releases the watch on stop()', async () => {
      const watcher = captureWatcher();
      const { discovery } = start();
      await discovery.scanNow();
      discovery.stop();
      expect(watcher.handle.close).toHaveBeenCalled();
    });

    // Nothing creates the worktrees directory until the first worktree
    // is made, so an unwatchable path has to be ordinary, not fatal.
    it('keeps scanning when the directory cannot be watched', async () => {
      watchMock.mockImplementation(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const { discovery, onChanged } = start();
      await discovery.scanNow();
      listWorktreesMock.mockResolvedValue(worktrees('feature-a'));
      await discovery.scanNow();
      expect(onChanged).toHaveBeenCalled();
    });

    it('re-establishes the watch once the directory exists', async () => {
      watchMock.mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const { discovery } = start();
      await discovery.scanNow();
      expect(watchMock.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
