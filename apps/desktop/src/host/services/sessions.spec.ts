import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionsModule from './sessions.js';

/**
 * The PTY registry keys sessions by bare branch name — the same name
 * that names the worktree directory, so it can't be namespaced without
 * moving them. Two repositories with a branch of the same name
 * therefore collide on one key, and the desktop (unlike the TUI) lets
 * you switch repository while agents are running.
 *
 * These tests pin the ownership guards that keep one repo's UI from
 * reading, writing to, reattaching to or killing another repo's agent.
 */

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  alive: new Set<string>(),
  spawns: [] as { name: string; cwd: string; config: unknown }[],
  killed: [] as string[],
  onData: new Map<string, (data: string) => void>(),
  configByCwd: {} as Record<string, unknown>,
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
  createWorktree: (branch: string) =>
    Promise.resolve(`${state.cwd}/.claude/worktrees/${branch}`),
  listWorktrees: () => Promise.resolve([]),
}));

vi.mock('@kirby/app-core', () => ({
  buildReviewLaunchRequest: () => ({ branch: 'x', intent: 'review' }),
  launchSession: (spec: { name: string; cwd: string; config: unknown }) => {
    state.alive.add(spec.name);
    state.spawns.push({
      name: spec.name,
      cwd: spec.cwd,
      config: spec.config,
    });
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
  killSession: (name: string) => {
    state.killed.push(name);
    state.alive.delete(name);
  },
  isSessionAlive: (name: string) => state.alive.has(name),
  isTmuxSessionPersisted: () => false,
  getSpawnedAt: () => 1000,
  noteInput: () => undefined,
  noteResize: () => undefined,
  noteSeen: () => undefined,
  snapshot: (name: string) => ({
    active: state.alive.has(name),
    flashing: false,
  }),
}));

// The service keeps its known-session map in module scope, which is
// exactly the state these tests are about — so each test gets a fresh
// module rather than inheriting the previous test's sessions.
let sessions: typeof SessionsModule;
let getSessionActivity: typeof sessions.getSessionActivity;
let getSessionBuffer: typeof sessions.getSessionBuffer;
let killSession: typeof sessions.killSession;
let launchAgent: typeof sessions.launchAgent;
let listSessions: typeof sessions.listSessions;

beforeEach(async () => {
  state.cwd = '/repo-a';
  state.alive = new Set();
  state.spawns = [];
  state.killed = [];
  state.onData = new Map();
  state.configByCwd = {};

  vi.resetModules();
  sessions = await import('./sessions.js');
  ({
    getSessionActivity,
    getSessionBuffer,
    killSession,
    launchAgent,
    listSessions,
  } = sessions);
  sessions.setSessionBroadcaster(() => undefined);
});

/** Emit PTY output for a session, as the relay would. */
function emit(name: string, data: string) {
  state.onData.get(name)?.(data);
}

describe('launchAgent', () => {
  it('spawns the worktree session and reads config from the repo root', async () => {
    // Per-project config is keyed by a hash of the cwd, so reading it
    // from the worktree path resolves a different, empty bag.
    state.configByCwd['/repo-a'] = { marker: 'root-config' };
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });

    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0].name).toBe('feature-x');
    expect(state.spawns[0].cwd).toBe('/repo-a/.claude/worktrees/feature/x');
    expect(state.spawns[0].config).toEqual({ marker: 'root-config' });
  });

  it('collapses overlapping launches of the same branch into one spawn', async () => {
    // A double-click can race the renderer's isPending flag; a second
    // spawn would dispose the first PTY and attach a duplicate relay.
    const [a, b] = await Promise.all([
      launchAgent({ branch: 'race', intent: 'continue-or-blank' }),
      launchAgent({ branch: 'race', intent: 'continue-or-blank' }),
    ]);
    expect(a).toEqual(b);
    expect(state.spawns).toHaveLength(1);
  });

  it('reattaches to its own live session instead of respawning', async () => {
    await launchAgent({ branch: 'again', intent: 'continue-or-blank' });
    await launchAgent({ branch: 'again', intent: 'continue-or-blank' });
    expect(state.spawns).toHaveLength(1);
  });
});

describe('another repository owns the name', () => {
  /** Launch `branch` in repo A, then switch to repo B. */
  async function launchInAThenSwitch(branch = 'shared') {
    state.cwd = '/repo-a';
    await launchAgent({ branch, intent: 'continue-or-blank' });
    emit(branch, 'repo-a secrets');
    state.cwd = '/repo-b';
  }

  it('refuses to reattach, rather than handing over the other repo agent', async () => {
    await launchInAThenSwitch();
    await expect(
      launchAgent({ branch: 'shared', intent: 'continue-or-blank' })
    ).rejects.toThrow('already running for another repository');
    // And it did not quietly spawn a second one either.
    expect(state.spawns).toHaveLength(1);
  });

  it('refuses to kill it', async () => {
    await launchInAThenSwitch();
    expect(() => killSession('shared')).toThrow(
      'already running for another repository'
    );
    expect(state.killed).toEqual([]);
  });

  it('hides it from the session list', async () => {
    await launchInAThenSwitch();
    expect(listSessions()).toEqual([]);
    state.cwd = '/repo-a';
    expect(listSessions().map((s) => s.name)).toEqual(['shared']);
  });

  it('hides it from the activity map', async () => {
    await launchInAThenSwitch();
    expect(getSessionActivity()).toEqual({});
  });

  it('does not hand over its scrollback', async () => {
    await launchInAThenSwitch();
    // The buffer holds whatever the other repo's agent printed.
    expect(getSessionBuffer('shared').data).toBe('');
    state.cwd = '/repo-a';
    expect(getSessionBuffer('shared').data).toBe('repo-a secrets');
  });

  it('leaves a name this host never launched to the registry', () => {
    // No entry means no ownership claim — killing is a no-op there
    // rather than an error, matching the registry's own behaviour.
    expect(() => killSession('never-seen')).not.toThrow();
    expect(state.killed).toEqual(['never-seen']);
  });
});

describe('session buffer', () => {
  it('accumulates output with a monotonic sequence number', async () => {
    await launchAgent({ branch: 'buf', intent: 'continue-or-blank' });
    emit('buf', 'one ');
    emit('buf', 'two');

    // The seq lets a late subscriber drop chunks the snapshot covered.
    expect(getSessionBuffer('buf')).toEqual({ data: 'one two', seq: 2 });
  });

  it('is empty for a session that was never launched', () => {
    expect(getSessionBuffer('nothing')).toEqual({ data: '', seq: 0 });
  });

  it('drops the oldest output once the buffer is full', async () => {
    await launchAgent({ branch: 'big', intent: 'continue-or-blank' });
    const chunk = 'x'.repeat(256 * 1024);
    emit('big', chunk);
    emit('big', chunk);
    emit('big', chunk);

    // Bounded at 512 KiB: the scrollback stays useful without letting a
    // chatty agent grow the main process without limit.
    const { data } = getSessionBuffer('big');
    expect(data.length).toBeLessThanOrEqual(512 * 1024);
    expect(data.length).toBeGreaterThan(0);
  });
});
