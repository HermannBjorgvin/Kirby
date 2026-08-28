import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VcsProvider } from '@kirby/vcs-core';

/**
 * The sweep that deletes people's branches.
 *
 * Auto-delete-on-merge is the only thing in Kirby that destroys work
 * without being asked to each time, so every condition standing between
 * a merged pull request and `git branch -D` matters, and each one is a
 * separate way to lose something:
 *
 *   • a branch whose agent is still running is left alone, because the
 *     user deliberately left it running;
 *   • a branch git will not part with safely is left alone;
 *   • a provider that failed to answer means no deletions at all, not
 *     "nothing is merged, carry on";
 *   • and a cancelled pass stops between steps rather than finishing
 *     its deletions into a repo the user has since navigated away from.
 */

const env = vi.hoisted(() => ({
  merged: new Set<string>(),
  fetchThrows: false,
  alive: new Set<string>(),
  persisted: new Set<string>(),
  removable: {} as Record<string, { safe: boolean; reason?: string }>,
  deleted: [] as { session: string; branch: string }[],
  rebaseWarned: [] as string[],
  conflicts: {} as Record<string, number>,
  cancelAfterChecks: Infinity,
  checks: 0,
}));

vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (b: string) => b.replace(/\//g, '-'),
  canRemoveBranch: (branch: string) => {
    env.checks += 1;
    return Promise.resolve(env.removable[branch] ?? { safe: true });
  },
  countConflicts: (branch: string) =>
    Promise.resolve(env.conflicts[branch] ?? 0),
  fastForwardMainBranch: () => Promise.resolve(),
  fetchRemote: () => Promise.resolve(),
}));

vi.mock('@kirby/logger', () => ({ logError: () => undefined }));

vi.mock('../pty-registry.js', () => ({
  isSessionAlive: (name: string) => env.alive.has(name),
}));

vi.mock('../session-backend.js', () => ({
  isTmuxSessionPersisted: (_config: unknown, name: string) =>
    env.persisted.has(name),
}));

const {
  computeConflictCounts,
  diffRebaseWarnings,
  remoteSyncIntervalMs,
  REMOTE_SYNC_MIN_MS,
  sweepMergedBranches,
} = await import('./remote-sync.js');

const provider = {
  id: 'github',
  fetchMergedBranches: () => {
    if (env.fetchThrows) return Promise.reject(new Error('provider down'));
    return Promise.resolve(env.merged);
  },
} as unknown as VcsProvider;

function sweep(over: Partial<Parameters<typeof sweepMergedBranches>[0]> = {}) {
  return sweepMergedBranches({
    provider,
    vcsConfigured: true,
    config: { autoDeleteOnMerge: true } as never,
    branches: ['feature/a'],
    warnedRebase: new Set<string>(),
    onAutoDelete: (session, branch) => {
      env.deleted.push({ session, branch });
    },
    onRebaseInProgress: (branch) => env.rebaseWarned.push(branch),
    isCancelled: () => env.checks >= env.cancelAfterChecks,
    ...over,
  });
}

beforeEach(() => {
  env.merged = new Set(['feature/a']);
  env.fetchThrows = false;
  env.alive = new Set();
  env.persisted = new Set();
  env.removable = {};
  env.deleted = [];
  env.rebaseWarned = [];
  env.conflicts = {};
  env.cancelAfterChecks = Infinity;
  env.checks = 0;
});

describe('remoteSyncIntervalMs', () => {
  it('never polls the provider faster than the floor', () => {
    // A hand-edited config of 1 would otherwise hammer the API.
    expect(remoteSyncIntervalMs(1)).toBe(REMOTE_SYNC_MIN_MS);
    expect(remoteSyncIntervalMs(0)).toBe(REMOTE_SYNC_MIN_MS);
  });

  it('honours a longer interval, and falls back when unset', () => {
    expect(remoteSyncIntervalMs(7_200_000)).toBe(7_200_000);
    expect(remoteSyncIntervalMs(undefined)).toBeGreaterThanOrEqual(
      REMOTE_SYNC_MIN_MS
    );
  });
});

describe('diffRebaseWarnings', () => {
  it('warns once per rebase episode', () => {
    const first = diffRebaseWarnings(['a'], new Set());
    expect(first.toWarn).toEqual(['a']);

    const second = diffRebaseWarnings(['a'], first.nextWarned);
    expect(second.toWarn).toEqual([]);
  });

  it('warns again once the branch has stopped and started rebasing', () => {
    // Dropping out of the carried set is what allows a second episode
    // to be reported instead of staying silent forever.
    const warned = diffRebaseWarnings(['a'], new Set()).nextWarned;
    const cleared = diffRebaseWarnings([], warned).nextWarned;
    expect(diffRebaseWarnings(['a'], cleared).toWarn).toEqual(['a']);
  });
});

describe('sweepMergedBranches', () => {
  it('deletes a merged branch that is safe to remove', async () => {
    const result = await sweep();
    expect([...result.merged]).toEqual(['feature/a']);
    expect(env.deleted).toEqual([
      { session: 'feature-a', branch: 'feature/a' },
    ]);
  });

  it('leaves a branch alone when its agent is still running', async () => {
    // The user deliberately left that agent running; deleting the
    // worktree under it destroys whatever it had in memory.
    env.alive = new Set(['feature-a']);
    await sweep();
    expect(env.deleted).toEqual([]);
  });

  it('leaves a branch alone when a tmux session for it survived a restart', async () => {
    // Same agent, just not in this process's registry.
    env.persisted = new Set(['feature-a']);
    await sweep();
    expect(env.deleted).toEqual([]);
  });

  it('leaves a branch git will not part with safely', async () => {
    env.removable = { 'feature/a': { safe: false, reason: 'unpushed work' } };
    await sweep();
    expect(env.deleted).toEqual([]);
  });

  it('deletes nothing at all when auto-delete is off', async () => {
    const result = await sweep({
      config: { autoDeleteOnMerge: false } as never,
    });
    // The merged set is still reported: badges show, nothing is removed.
    expect([...result.merged]).toEqual(['feature/a']);
    expect(env.deleted).toEqual([]);
  });

  it('deletes nothing when the provider could not answer', async () => {
    // A failed lookup must not read as "nothing is merged" — and
    // certainly must not delete on the strength of it.
    env.fetchThrows = true;
    const result = await sweep();
    expect([...result.merged]).toEqual([]);
    expect(env.deleted).toEqual([]);
  });

  it('does nothing without a configured provider or any branches', async () => {
    expect((await sweep({ vcsConfigured: false })).merged.size).toBe(0);
    expect((await sweep({ provider: null })).merged.size).toBe(0);
    expect((await sweep({ branches: [] })).merged.size).toBe(0);
    expect(env.deleted).toEqual([]);
  });

  it('reports the merged set before starting the slow deletions', async () => {
    // Lets a UI show merged badges without waiting on git.
    const order: string[] = [];
    await sweep({
      onMerged: () => order.push('merged'),
      onAutoDelete: () => {
        order.push('deleted');
      },
    });
    expect(order).toEqual(['merged', 'deleted']);
  });

  it('stops deleting the moment the pass is cancelled', async () => {
    env.merged = new Set(['feature/a', 'feature/b', 'feature/c']);
    env.cancelAfterChecks = 1; // cancel after the first safety check
    await sweep({ branches: ['feature/a', 'feature/b', 'feature/c'] });
    expect(env.deleted.length).toBeLessThanOrEqual(1);
  });

  it('warns once about a branch blocked by a rebase', async () => {
    env.removable = {
      'feature/a': { safe: false, reason: 'rebase in progress' },
    };
    const first = await sweep();
    expect(env.rebaseWarned).toEqual(['feature/a']);

    env.rebaseWarned = [];
    await sweep({ warnedRebase: first.nextWarned });
    // Same rebase, still in progress: no second warning.
    expect(env.rebaseWarned).toEqual([]);
  });

  it('does not warn about a branch blocked for some other reason', async () => {
    env.removable = { 'feature/a': { safe: false, reason: 'unpushed work' } };
    await sweep();
    expect(env.rebaseWarned).toEqual([]);
  });
});

describe('computeConflictCounts', () => {
  it('counts each branch', async () => {
    env.conflicts = { a: 2, b: 0 };
    const counts = await computeConflictCounts(['a', 'b']);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(0);
  });
});
