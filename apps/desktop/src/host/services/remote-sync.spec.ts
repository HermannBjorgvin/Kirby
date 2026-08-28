import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as RemoteSyncModule from './remote-sync.js';

/**
 * The sync loop runs git operations — including auto-deleting merged
 * branches — against `process.cwd()`, which the desktop changes when
 * the user opens another repository. A pass that keeps going after a
 * repo switch would therefore run the *old* repo's branch list against
 * the *new* checkout, and a pass that keeps going after quit can exit
 * between removing a worktree and deleting its branch.
 *
 * Both are prevented by a generation counter, and both are what these
 * tests are about.
 */

const env = vi.hoisted(() => ({
  configured: true,
  branches: ['feature/a'] as string[],
  merged: new Set<string>(),
  conflicts: new Map<string, number>(),
  sweeps: 0,
  removed: [] as { branch: string; force: boolean }[],
  notices: [] as { message: string; kind: string }[],
  /** Resolvers for each syncRemote() call, in order. */
  pending: [] as ((ts: number) => void)[],
  rejects: [] as ((e: Error) => void)[],
  sweepThrows: false,
  autoDelete: null as string | null,
}));

function nextSync(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    env.pending.push(resolve);
    env.rejects.push(reject);
  });
}

vi.mock('./repo.js', () => ({
  PROVIDERS: [{ id: 'github', isConfigured: () => env.configured }],
  requireRepo: () => '/repo-a',
}));

vi.mock('./worktrees.js', () => ({
  removeWorktree: (branch: string, force: boolean) => {
    env.removed.push({ branch, force });
    return Promise.resolve(true);
  },
}));

vi.mock('@kirby/vcs-core', () => ({
  readConfig: () => ({ vendor: 'github', mergePollInterval: 999 }),
}));

vi.mock('@kirby/worktree-manager', () => ({
  listWorktrees: () =>
    Promise.resolve(env.branches.map((branch) => ({ branch }))),
}));

vi.mock('@kirby/app-core', () => ({
  remoteSyncIntervalMs: () => 3_600_000,
  syncRemote: () => nextSync(),
  sweepMergedBranches: async (opts: {
    isCancelled: () => boolean;
    onAutoDelete: (session: string, branch: string) => Promise<void>;
  }) => {
    env.sweeps += 1;
    if (env.sweepThrows) throw new Error('provider unreachable');
    if (env.autoDelete) {
      await opts.onAutoDelete(env.autoDelete, env.autoDelete);
    }
    return { merged: env.merged, nextWarned: new Set<string>() };
  },
  computeConflictCounts: () => Promise.resolve(env.conflicts),
}));

let sync: typeof RemoteSyncModule;

/** Let queued microtasks (the pass chain) run to completion. */
async function flush(times = 6) {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

beforeEach(async () => {
  env.configured = true;
  env.branches = ['feature/a'];
  env.merged = new Set();
  env.conflicts = new Map();
  env.sweeps = 0;
  env.removed = [];
  env.notices = [];
  env.pending = [];
  env.rejects = [];
  env.sweepThrows = false;
  env.autoDelete = null;

  vi.resetModules();
  sync = await import('./remote-sync.js');
  sync.setSyncNotifier((n) => env.notices.push(n));
});

afterEach(() => {
  sync.stopRemoteSyncLoop();
});

describe('cancellation', () => {
  it('abandons an in-flight pass when the loop is stopped', async () => {
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    expect(env.pending).toHaveLength(1); // the pass is awaiting git

    sync.stopRemoteSyncLoop();
    env.pending[0](Date.now());
    await flush();

    // Quitting mid-pass must not let the sweep — and its auto-delete —
    // continue into a process that is about to exit.
    expect(env.sweeps).toBe(0);
  });

  it('abandons the previous repo pass when another repo is opened', async () => {
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    expect(env.pending).toHaveLength(1);

    sync.startRemoteSyncLoop('/repo-b');
    // Passes are serialized, so B waits for A's chain to unwind.
    env.pending[0](Date.now());
    await flush();

    // A resumed, saw a newer generation and returned before running any
    // git against what is now a different checkout.
    expect(env.sweeps).toBe(0);
    // B is the one now waiting on git.
    expect(env.pending).toHaveLength(2);
  });

  it('runs the pass through when nothing interrupts it', async () => {
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    env.pending[0](1234);
    await flush();

    expect(env.sweeps).toBe(1);
    expect(sync.getSyncDecorations().lastGitSyncAt).toBe(1234);
  });
});

describe('decorations across repo changes', () => {
  async function completeAPass(cwd: string) {
    sync.startRemoteSyncLoop(cwd);
    await flush();
    env.pending[env.pending.length - 1](1000);
    await flush();
  }

  it('drops the previous repo badges when switching repository', async () => {
    env.merged = new Set(['feature/a']);
    await completeAPass('/repo-a');
    expect(sync.getSyncDecorations().merged.size).toBe(1);

    sync.startRemoteSyncLoop('/repo-b');
    // Stale "merged" badges from another checkout would be wrong, not
    // merely out of date.
    expect(sync.getSyncDecorations().merged.size).toBe(0);
  });

  it('keeps them when the same repo restarts for a new interval', async () => {
    env.merged = new Set(['feature/a']);
    await completeAPass('/repo-a');

    sync.startRemoteSyncLoop('/repo-a');
    // Same checkout, so the badges are still true — blinking them out
    // until the next pass would just look like a glitch.
    expect(sync.getSyncDecorations().merged.size).toBe(1);
  });
});

describe('gating and effects', () => {
  it('does no git work when the provider is not configured', async () => {
    env.configured = false;
    sync.startRemoteSyncLoop('/repo-a');
    await flush();

    // Matches the TUI, which gates its polling the same way.
    expect(env.pending).toHaveLength(0);
    expect(env.sweeps).toBe(0);
  });

  it('force-removes an auto-deleted merged branch and says so', async () => {
    env.autoDelete = 'feature/a';
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    env.pending[0](1000);
    await flush();

    expect(env.removed).toEqual([{ branch: 'feature/a', force: true }]);
    expect(env.notices).toEqual([
      { message: 'Auto-deleted merged branch: feature/a', kind: 'success' },
    ]);
  });

  it('does not auto-delete after the loop was stopped', async () => {
    env.autoDelete = 'feature/a';
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    sync.stopRemoteSyncLoop();
    env.pending[0](1000);
    await flush();

    expect(env.removed).toEqual([]);
  });
});

describe('when git or the provider is unreachable', () => {
  async function completeAPass(ts = 1000) {
    await flush();
    env.pending[env.pending.length - 1](ts);
    await flush();
  }

  it('keeps the badges from the last good pass when a fetch fails', async () => {
    env.merged = new Set(['feature/a']);
    sync.startRemoteSyncLoop('/repo-a');
    await completeAPass(1000);
    expect(sync.getSyncDecorations().merged.size).toBe(1);

    // Second pass: the fetch fails, as it does on a dropped network or
    // an upstream that has gone away.
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    env.rejects[env.rejects.length - 1](new Error('could not resolve host'));
    await flush();

    // Badges are still true as of the last successful pass; blanking
    // them would report every branch as unmerged and conflict-free.
    expect(sync.getSyncDecorations().merged.size).toBe(1);
    expect(sync.getSyncDecorations().lastGitSyncAt).toBe(1000);
  });

  it('survives the sweep itself failing', async () => {
    env.sweepThrows = true;
    sync.startRemoteSyncLoop('/repo-a');
    await completeAPass();

    // A provider error mid-pass is caught; nothing is auto-deleted on
    // the strength of a half-finished answer.
    expect(env.removed).toEqual([]);
    expect(sync.getSyncDecorations().lastGitSyncAt).toBeNull();
  });

  it('runs again after a failure rather than giving up', async () => {
    sync.startRemoteSyncLoop('/repo-a');
    await flush();
    env.rejects[0](new Error('offline'));
    await flush();

    // A transient failure must not leave the app permanently stale;
    // the next pass has to go out.
    env.sweepThrows = false;
    sync.startRemoteSyncLoop('/repo-a');
    await completeAPass(2000);
    expect(env.sweeps).toBe(1);
    expect(sync.getSyncDecorations().lastGitSyncAt).toBe(2000);
  });
});
