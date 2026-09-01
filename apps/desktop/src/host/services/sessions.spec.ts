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
 *
 * Attaching to sessions this process did not start is discovery's job
 * now — see `discovery.spec.ts` for the desktop half and
 * `libs/core/src/lib/discovery` for the decisions behind it.
 */

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  alive: new Set<string>(),
  spawns: [] as {
    name: string;
    cwd: string;
    config: unknown;
    request: unknown;
  }[],
  killed: [] as string[],
  onData: new Map<string, (data: string) => void>(),
  configByCwd: {} as Record<string, unknown>,
  createFails: new Set<string>(),
  /** Prompts core's checkoutPlan delivered into a live agent. */
  injected: [] as { name: string; prompt: string }[],
  /** Branch names whose checkout core should report as failed. */
  checkoutFails: new Set<string>(),
  /** What core resolves an unset `terminalBackend` to — i.e. whether
   *  this machine was found to have tmux. */
  defaultBackend: 'pty' as 'pty' | 'tmux',
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
  // Stands in for the real orchestrator, whose own branching is tested
  // in libs/core. What matters here is what the *desktop* does with
  // each outcome: inject changes nothing it tracks, a spawn has to be
  // adopted so its output reaches the renderer.
  checkoutPlan: (deps: {
    pr: { sourceBranch: string };
    prompt: string;
    mode: 'inject' | 'new-session';
    flashStatus: (msg: string) => void;
  }) => {
    const name = deps.pr.sourceBranch.replace(/\//g, '-');
    if (state.checkoutFails.has(deps.pr.sourceBranch)) {
      deps.flashStatus(`Failed to create worktree for ${deps.pr.sourceBranch}`);
      return Promise.resolve('failed');
    }
    if (state.alive.has(name) && deps.mode === 'inject') {
      state.injected.push({ name, prompt: deps.prompt });
      return Promise.resolve('injected');
    }
    state.alive.add(name);
    state.spawns.push({
      name,
      cwd: `/wt/${deps.pr.sourceBranch}`,
      config: null,
      request: { intent: 'seed', prompt: deps.prompt },
    });
    return Promise.resolve('spawned');
  },
  buildReviewLaunchRequest: (pr: { id: number }, instruction?: string) => ({
    intent: 'review',
    prompt: `review #${pr.id}${instruction ? `: ${instruction}` : ''}`,
    systemGuidance: 'guidance',
  }),
  launchSession: (spec: {
    name: string;
    cwd: string;
    config: unknown;
    request: unknown;
  }) => {
    state.alive.add(spec.name);
    state.spawns.push({
      name: spec.name,
      cwd: spec.cwd,
      config: spec.config,
      request: spec.request,
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
  resolveTerminalBackend: (config: { terminalBackend?: 'pty' | 'tmux' }) =>
    config.terminalBackend ?? state.defaultBackend,
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
let checkoutPlan: typeof sessions.checkoutPlan;
let launchReviewAgent: typeof sessions.launchReviewAgent;
let listSessions: typeof sessions.listSessions;

beforeEach(async () => {
  state.cwd = '/repo-a';
  state.alive = new Set();
  state.spawns = [];
  state.killed = [];
  state.onData = new Map();
  state.configByCwd = {};
  state.createFails = new Set();
  state.injected = [];
  state.checkoutFails = new Set();
  state.defaultBackend = 'pty';

  vi.resetModules();
  sessions = await import('./sessions.js');
  ({
    checkoutPlan,
    getSessionActivity,
    getSessionBuffer,
    killSession,
    launchAgent,
    launchReviewAgent,
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

  it('reports it as not alive here, so this repo does not show it running', () => {
    // The sidebar asks this per worktree row. `isSessionAlive` alone is
    // answered from a registry keyed by the bare branch name, so the
    // other repo's agent would make this repo's same-named row look
    // live — and `sync-items` would auto-open a tab onto an agent this
    // repo cannot reach, kill or relaunch.
    return launchInAThenSwitch().then(() => {
      expect(sessions.isOwnSessionAlive('shared')).toBe(false);
      state.cwd = '/repo-a';
      expect(sessions.isOwnSessionAlive('shared')).toBe(true);
    });
  });

  it('skips it during worktree removal instead of killing it', async () => {
    await launchInAThenSwitch();
    // Housekeeping inside a legitimate operation: removing this repo's
    // `shared` worktree must not reach the other repo's agent, and must
    // not abort the removal either.
    expect(() => sessions.killOwnSession('shared')).not.toThrow();
    expect(state.killed).toEqual([]);
    state.cwd = '/repo-a';
    sessions.killOwnSession('shared');
    expect(state.killed).toEqual(['shared']);
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

describe('launchReviewAgent', () => {
  it('launches on the pull request branch with the review prompt', async () => {
    // The prompt and guidance come from app-core so the desktop and the
    // TUI seed a review identically; the branch is the PR's source, not
    // whatever is checked out.
    await launchReviewAgent({
      pr: { id: 42, sourceBranch: 'feature/review' },
      instruction: 'focus on error handling',
    } as Parameters<typeof launchReviewAgent>[0]);

    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0].name).toBe('feature-review');
    expect(state.spawns[0].request).toMatchObject({
      intent: 'review',
      prompt: 'review #42: focus on error handling',
      systemGuidance: 'guidance',
    });
  });

  it('goes through the same de-duplication as a plain launch', async () => {
    const pr = { id: 1, sourceBranch: 'dup' };
    await Promise.all([
      launchReviewAgent({ pr } as Parameters<typeof launchReviewAgent>[0]),
      launchReviewAgent({ pr } as Parameters<typeof launchReviewAgent>[0]),
    ]);
    expect(state.spawns).toHaveLength(1);
  });
});

// ── Plan checkout ────────────────────────────────────────────────

describe('checkoutPlan', () => {
  const pr = { id: 7, sourceBranch: 'feature/x' } as never;
  const req = (mode: 'inject' | 'new-session' = 'new-session') => ({
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: fix it',
    mode,
  });

  it('adopts a spawned session so its output reaches the renderer', async () => {
    // core does the spawning; without the host adopting it, the PTY
    // runs with nothing relaying it and the terminal pane stays blank.
    await expect(checkoutPlan(req())).resolves.toBe('spawned');
    emit('feature-x', 'agent says hello');
    expect(getSessionBuffer('feature-x').data).toBe('agent says hello');
    expect(listSessions().map((s) => s.name)).toEqual(['feature-x']);
  });

  it('injecting neither spawns nor disturbs the scrollback', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    emit('feature-x', 'existing conversation');
    state.spawns = [];

    await expect(checkoutPlan(req('inject'))).resolves.toBe('injected');

    expect(state.spawns).toEqual([]);
    expect(state.injected).toEqual([
      { name: 'feature-x', prompt: req().prompt },
    ]);
    // The pane is showing this text; a reset would blank it.
    expect(getSessionBuffer('feature-x').data).toBe('existing conversation');
  });

  /**
   * A mounted terminal remembers the sequence number its replay ended
   * at and drops anything at or below it. Numbering a restarted
   * session's chunks from 1 again therefore makes the new agent look
   * dead in a pane that is still on screen — which is exactly the pane
   * you are looking at when you restart one with a plan.
   */
  it('keeps chunk numbering monotonic when it restarts a session', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    emit('feature-x', 'first run');
    const before = getSessionBuffer('feature-x').seq;
    expect(before).toBe(1);

    await checkoutPlan(req('new-session'));
    emit('feature-x', 'second run');

    const after = getSessionBuffer('feature-x');
    expect(after.seq).toBeGreaterThan(before);
    // The scrollback itself does start over — it is a new agent.
    expect(after.data).toBe('second run');
  });

  it('rejects with the reason, so the plan can be retried', async () => {
    state.checkoutFails.add('feature/x');
    await expect(checkoutPlan(req())).rejects.toThrow(
      'Failed to create worktree for feature/x'
    );
  });

  it('refuses to deliver into another repository’s agent', async () => {
    state.cwd = '/repo-a';
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    state.cwd = '/repo-b';

    expect(() => checkoutPlan(req('inject'))).toThrow(
      'already running for another repository'
    );
    expect(state.injected).toEqual([]);
  });

  it('collapses a double-send into one delivery', async () => {
    const [a, b] = await Promise.all([
      checkoutPlan(req()),
      checkoutPlan(req()),
    ]);
    expect([a, b]).toEqual(['spawned', 'spawned']);
    expect(state.spawns).toHaveLength(1);
  });
});
