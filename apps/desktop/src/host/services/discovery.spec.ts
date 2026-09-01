import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionDiscoveryOptions } from '@kirby/core';
import type * as DiscoveryModule from './discovery.js';
import type * as SessionsModule from './sessions.js';

/**
 * The desktop's half of external-session discovery.
 *
 * What decides *whether* a session should be attached to — the backend,
 * whether tmux still has it, whether this process already holds a PTY
 * for it — belongs to `@kirby/core` and is tested in
 * `libs/core/src/lib/discovery`. `startSessionDiscovery` is stubbed here
 * so these tests can drive the callbacks the desktop supplies and assert
 * only on what the desktop contributes: the launch path an attach goes
 * through, the repositories it refuses to touch, and telling the
 * renderer.
 */

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  alive: new Set<string>(),
  spawns: [] as { name: string; cwd: string }[],
  onData: new Map<string, (data: string) => void>(),
  configByCwd: {} as Record<string, unknown>,
  createFails: new Set<string>(),
  /** Options the most recent startSessionDiscovery call was given. */
  opts: null as SessionDiscoveryOptions | null,
  stops: 0,
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => state.cwd,
  activeRepoIs: (cwd: string) => cwd === state.cwd,
}));

vi.mock('@kirby/vcs-core', () => ({
  readConfig: (cwd: string) => state.configByCwd[cwd] ?? { fromCwd: cwd },
}));

vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
  createWorktree: (branch: string) => {
    if (state.createFails.has(branch)) {
      return Promise.reject(new Error(`git refused ${branch}`));
    }
    return Promise.resolve(`${state.cwd}/.claude/worktrees/${branch}`);
  },
}));

vi.mock('@kirby/core', () => ({
  startSessionDiscovery: (opts: SessionDiscoveryOptions) => {
    state.opts = opts;
    return {
      scanNow: () => Promise.resolve(),
      stop: () => {
        state.stops += 1;
      },
    };
  },
  launchSession: (spec: { name: string; cwd: string }) => {
    state.alive.add(spec.name);
    state.spawns.push({ name: spec.name, cwd: spec.cwd });
  },
  getSession: (name: string) =>
    state.alive.has(name)
      ? {
          exited: false,
          pty: {
            onData: (cb: (data: string) => void) => state.onData.set(name, cb),
            onExit: () => undefined,
            write: () => undefined,
            resize: () => undefined,
          },
        }
      : undefined,
  isSessionAlive: (name: string) => state.alive.has(name),
  killSession: () => undefined,
  checkoutPlan: () => Promise.resolve('spawned'),
  buildReviewLaunchRequest: () => ({ intent: 'blank' }),
  getSpawnedAt: () => 1000,
  noteInput: () => undefined,
  noteResize: () => undefined,
  noteSeen: () => undefined,
  snapshot: () => ({ active: false, flashing: false }),
}));

let discovery: typeof DiscoveryModule;
let sessions: typeof SessionsModule;

const worktree = (branch: string) => ({
  name: branch.replace(/\//g, '-'),
  branch,
  path: `/repo-a/.claude/worktrees/${branch}`,
});

/** The options the service handed the scanner. */
function opts(): SessionDiscoveryOptions {
  if (!state.opts) throw new Error('discovery was never started');
  return state.opts;
}

beforeEach(async () => {
  state.cwd = '/repo-a';
  state.alive = new Set();
  state.spawns = [];
  state.onData = new Map();
  state.configByCwd = {};
  state.createFails = new Set();
  state.opts = null;
  state.stops = 0;

  vi.resetModules();
  sessions = await import('./sessions.js');
  sessions.setSessionBroadcaster(() => undefined);
  discovery = await import('./discovery.js');
});

describe('startDiscoveryForRepo', () => {
  it('attaches through the normal launch path, output relay and all', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await opts().adopt(worktree('feature/x'));

    expect(state.spawns).toEqual([
      { name: 'feature-x', cwd: '/repo-a/.claude/worktrees/feature/x' },
    ]);
    // Adopted by the host, not merely spawned: without the relay the
    // agent runs with nothing forwarding it and the pane stays blank.
    state.onData.get('feature-x')?.('agent says hello');
    expect(sessions.getSessionBuffer('feature-x').data).toBe(
      'agent says hello'
    );
    expect(sessions.listSessions().map((s) => s.name)).toEqual(['feature-x']);
  });

  // The desktop is branch-keyed from the worktree it resolves down to
  // the tab it opens, so a detached-HEAD orphan has nothing to key on.
  // Rejecting (rather than quietly skipping) is what stops the scanner
  // offering it again on every tick.
  it('rejects a worktree with no branch instead of skipping it', async () => {
    discovery.startDiscoveryForRepo('/repo-a');
    await expect(
      opts().adopt({ name: 'detached', branch: '', path: '/wt/detached' })
    ).rejects.toThrow('no branch checked out');
    expect(state.spawns).toEqual([]);
  });

  it('lets a failed attach reject so it is not retried forever', async () => {
    state.createFails.add('broken');
    discovery.startDiscoveryForRepo('/repo-a');
    await expect(opts().adopt(worktree('broken'))).rejects.toThrow(
      'git refused broken'
    );
  });

  it('reads config from the repo it was started for', () => {
    state.configByCwd['/repo-a'] = { terminalBackend: 'tmux' };
    discovery.startDiscoveryForRepo('/repo-a');
    expect(opts().getConfig()).toEqual({ terminalBackend: 'tmux' });
  });

  // A scan that began before a repo switch must not finish against the
  // new one: launchAgent would take this repo's branch names and create
  // them over there — phantom branches, worktrees and agents.
  it('reports itself stale once another repository is open', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    expect(opts().isCurrent?.()).toBe(true);
    state.cwd = '/repo-b';
    expect(opts().isCurrent?.()).toBe(false);
  });

  it('stops the previous repo scanner before starting another', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    expect(state.stops).toBe(0);
    discovery.startDiscoveryForRepo('/repo-b');
    expect(state.stops).toBe(1);
  });
});

describe('the change notification', () => {
  const delta = {
    appeared: [],
    disappeared: [],
    adoptable: [],
    ended: [],
    changed: true,
  };

  it('reaches the renderer', () => {
    const notify = vi.fn();
    discovery.setDiscoveryNotifier(notify);
    discovery.startDiscoveryForRepo('/repo-a');
    opts().onChanged(delta);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('is harmless before main.ts has installed a notifier', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    expect(() => opts().onChanged(delta)).not.toThrow();
  });
});

describe('stopDiscovery', () => {
  it('stops a running scanner', () => {
    discovery.startDiscoveryForRepo('/repo-a');
    discovery.stopDiscovery();
    expect(state.stops).toBe(1);
  });

  it('is safe with nothing running, and does not stop twice', () => {
    discovery.stopDiscovery();
    discovery.startDiscoveryForRepo('/repo-a');
    discovery.stopDiscovery();
    discovery.stopDiscovery();
    expect(state.stops).toBe(1);
  });
});
