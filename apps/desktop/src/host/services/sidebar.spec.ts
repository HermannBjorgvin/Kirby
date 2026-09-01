import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SidebarModule from './sidebar.js';

/**
 * The renderer polls the sidebar model continuously, so remote pull
 * request data is cached here behind a TTL. That cache is where the
 * subtle failures live: a forced refresh joining a stale in-flight
 * request, a slow response committing over a fresher one, or a fetch
 * started before a repo switch landing in the new repo's cache.
 */

const env = vi.hoisted(() => ({
  cwd: '/repo-a',
  config: {} as Record<string, unknown>,
  configured: true,
  worktrees: [] as { branch?: string; state?: string }[],
  /** Resolvers for each provider fetch, in call order. */
  pending: [] as {
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  }[],
  fetchCount: 0,
  now: 1_000_000,
  /** Last sessionBranchMap handed to buildSidebarItems. */
  lastBranchMap: new Map<string, string>(),
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => env.cwd,
  PROVIDERS: [
    {
      id: 'github',
      isConfigured: () => env.configured,
      fetchPullRequests: () => {
        env.fetchCount += 1;
        return new Promise((resolve, reject) => {
          env.pending.push({
            resolve: resolve as (v: Record<string, unknown>) => void,
            reject,
          });
        });
      },
    },
  ],
}));

vi.mock('./remote-sync.js', () => ({
  getSyncDecorations: () => ({
    merged: new Set<string>(),
    conflicts: new Map<string, number>(),
    lastGitSyncAt: 42,
  }),
}));

vi.mock('@kirby/vcs-core', () => ({
  readConfig: () => ({ vendor: 'github', ...env.config }),
}));

vi.mock('@kirby/worktree-manager', () => ({
  listWorktrees: () => Promise.resolve(env.worktrees),
  worktreeSessionName: (wt: { branch?: string }) =>
    (wt.branch ?? 'detached').replace(/\//g, '-'),
}));

vi.mock('@kirby/core', () => ({
  isSessionAlive: () => false,
  buildSessionLookups: () => ({
    sessionBranchMap: new Map<string, string>(),
    sessionPrMap: new Map<string, unknown>(),
  }),
  findOrphanPrs: () => [],
  categorizeReviews: () => ({
    needsReview: [],
    waitingForAuthor: [],
    approvedByYou: [],
  }),
  sortSessionsByPrId: (sessions: unknown[]) => sessions,
  buildSidebarItems: (
    sessions: unknown[],
    _orphans: unknown,
    _reviews: unknown,
    sessionBranchMap: Map<string, string>
  ) => {
    env.lastBranchMap = sessionBranchMap;
    return sessions;
  },
}));

let sidebar: typeof SidebarModule;

/** Settle the promise chain without advancing the clock. */
async function flush(times = 4) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

beforeEach(async () => {
  env.cwd = '/repo-a';
  env.config = {};
  env.configured = true;
  env.worktrees = [];
  env.pending = [];
  env.fetchCount = 0;
  env.now = 1_000_000;
  env.lastBranchMap = new Map();

  vi.spyOn(Date, 'now').mockImplementation(() => env.now);
  vi.resetModules();
  sidebar = await import('./sidebar.js');
});

/** Resolve the nth outstanding provider fetch. */
function settle(index = 0, value: Record<string, unknown> = {}) {
  env.pending[index].resolve(value);
}

describe('remote cache', () => {
  it('serves the cache inside the TTL and refetches after it', async () => {
    const first = sidebar.refreshRemote();
    await flush();
    settle(0, { a: 1 });
    await first;
    expect(env.fetchCount).toBe(1);

    env.now += 30_000; // default TTL is 60s
    await sidebar.getSidebarModel();
    expect(env.fetchCount).toBe(1);

    env.now += 31_000;
    const later = sidebar.getSidebarModel();
    await flush();
    settle(1, { a: 1 });
    await later;
    expect(env.fetchCount).toBe(2);
  });

  it('honours prPollInterval as the TTL', async () => {
    env.config = { prPollInterval: 5_000 };
    const first = sidebar.refreshRemote();
    await flush();
    settle(0);
    await first;

    env.now += 6_000;
    const second = sidebar.getSidebarModel();
    await flush();
    settle(1);
    await second;
    expect(env.fetchCount).toBe(2);
  });

  it('collapses concurrent polls into one provider request', async () => {
    const a = sidebar.getSidebarModel();
    const b = sidebar.getSidebarModel();
    await flush();
    expect(env.fetchCount).toBe(1);
    settle(0);
    await Promise.all([a, b]);
  });

  it('gives a forced refresh its own request rather than a stale one', async () => {
    const poll = sidebar.getSidebarModel();
    await flush();
    expect(env.fetchCount).toBe(1);

    // Joining the in-flight request would answer the user's explicit
    // refresh with data fetched before they asked.
    const forced = sidebar.refreshRemote();
    await flush();
    expect(env.fetchCount).toBe(2);

    settle(0);
    settle(1);
    await Promise.all([poll, forced]);
  });

  it('lets the newest fetch win when an older one lands last', async () => {
    const poll = sidebar.refreshRemote();
    await flush();
    const forced = sidebar.refreshRemote();
    await flush();

    // Newer request answers first, then the older one arrives.
    env.now = 2_000_000;
    settle(1, { fresh: true });
    await forced;
    env.now = 3_000_000;
    settle(0, { stale: true });
    await poll;

    // The stale response must not overwrite the cache — nor stamp it
    // with a newer timestamp, which would hide the staleness.
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBe(2_000_000);
  });

  it('keeps serving the last good data when a fetch fails', async () => {
    const ok = sidebar.refreshRemote();
    await flush();
    settle(0, { a: 1 });
    await ok;

    const bad = sidebar.refreshRemote();
    await flush();
    env.pending[1].reject(new Error('provider exploded'));
    await bad;

    // Blanking the sidebar on a transient API error would be worse
    // than showing data a minute old.
    const state = sidebar.getSyncState();
    expect(state.remoteError).toBe('provider exploded');
    expect(state.lastRemoteSyncAt).toBe(1_000_000);
  });

  it('clears a previous error once a fetch succeeds', async () => {
    const bad = sidebar.refreshRemote();
    await flush();
    env.pending[0].reject(new Error('nope'));
    await bad;
    expect(sidebar.getSyncState().remoteError).toBe('nope');

    const good = sidebar.refreshRemote();
    await flush();
    settle(1);
    await good;
    expect(sidebar.getSyncState().remoteError).toBeNull();
  });

  /**
   * Replacing a rejected access token has to look like it worked. The
   * cache still holds what the old credentials fetched, and the error
   * on screen describes a state that no longer exists.
   */
  describe('after the credentials change', () => {
    it('clears the error and fetches without waiting for the TTL', async () => {
      const bad = sidebar.refreshRemote();
      await flush();
      env.pending[0].reject(new Error('rejected the access token'));
      await bad;
      expect(sidebar.getSyncState().remoteError).toContain('access token');

      sidebar.onCredentialsChanged();
      // Cleared before the attempt, not after it: leaving the old
      // message up is what made a correct fix look like it had not
      // taken.
      expect(sidebar.getSyncState().remoteError).toBeNull();
      await flush();
      expect(env.fetchCount).toBe(2);
      settle(1, { a: 1 });
    });

    it('does not serve what the old credentials fetched', async () => {
      const first = sidebar.refreshRemote();
      await flush();
      settle(0, { a: 1 });
      await first;
      expect(env.fetchCount).toBe(1);

      sidebar.onCredentialsChanged();
      await flush();
      // Inside the TTL, so without dropping the cache this would have
      // answered from data fetched as somebody else.
      expect(env.fetchCount).toBe(2);
      settle(1, { a: 1 });
    });

    it('tells the renderer straight away', async () => {
      let announced = 0;
      sidebar.setRemoteUpdatedNotifier(() => announced++);
      sidebar.onCredentialsChanged();
      // The cleared error is itself a change worth painting, before
      // the fetch it started has landed.
      expect(announced).toBe(1);
      await flush();
      settle(0, {});
      sidebar.setRemoteUpdatedNotifier(null);
    });
  });

  it('does not call the provider at all when it is not configured', async () => {
    env.configured = false;
    await sidebar.getSidebarModel();
    expect(env.fetchCount).toBe(0);
    expect(sidebar.getSyncState().providerConfigured).toBe(false);
  });

  it('reports no last-sync time for a repo the cache is not about', async () => {
    const first = sidebar.refreshRemote();
    await flush();
    settle(0);
    await first;
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBe(1_000_000);

    env.cwd = '/repo-b';
    // The cached timestamp belongs to the other checkout; reporting it
    // here would claim this repo had just synced.
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBeNull();
  });
});

describe('sidebar model', () => {
  it('shows a worktree its real branch name, not the sanitized session name', async () => {
    // Session names flatten slashes, and only branches with a PR are in
    // the lookup — so a PR-less `feat/foo` would display as `feat-foo`.
    env.worktrees = [{ branch: 'feat/foo' }];
    const model = sidebar.getSidebarModel();
    await flush();
    settle(0);
    await model;

    expect(env.lastBranchMap.get('feat-foo')).toBe('feat/foo');
  });

  it('carries a mid-rebase worktree state through to its session', async () => {
    env.worktrees = [{ branch: 'rebasing-one', state: 'rebasing' }];
    const model = sidebar.getSidebarModel();
    await flush();
    settle(0);
    const items = (await model) as { state?: string }[];
    expect(items[0].state).toBe('rebasing');
  });

  it('omits the state key entirely for a normal worktree', async () => {
    env.worktrees = [{ branch: 'normal' }];
    const model = sidebar.getSidebarModel();
    await flush();
    settle(0);
    const items = (await model) as Record<string, unknown>[];
    expect('state' in items[0]).toBe(false);
  });
});

/**
 * The sidebar is the left half of the window, and most of what it
 * shows — worktrees, their agents, their git state — is local and
 * available in milliseconds. Pull requests are not: they are a network
 * round trip away, and on a cold start there is no cache to serve them
 * from. Waiting for the second before painting the first cost roughly
 * three quarters of a second of empty sidebar on every launch.
 */
describe('the model never waits for the provider', () => {
  it('answers from local git while the provider call is still in flight', async () => {
    env.worktrees = [{ branch: 'feature' }];

    // No `settle` anywhere: if this ever awaits the fetch again, the
    // await below never resolves and the test times out.
    const model = (await sidebar.getSidebarModel()) as unknown[];

    expect(model).toHaveLength(1);
    expect(env.fetchCount).toBe(1);
    expect(env.pending).toHaveLength(1);
  });

  it('serves the pull requests on the next call, once they have landed', async () => {
    env.worktrees = [{ branch: 'feature' }];
    await sidebar.getSidebarModel();
    settle(0, { feature: { id: 7 } });
    await flush();

    await sidebar.getSidebarModel();
    // Still one request: the second call read the cache the first
    // call's fetch filled, rather than starting another.
    expect(env.fetchCount).toBe(1);
  });

  it('announces the pull requests when the background fetch commits', async () => {
    let announced = 0;
    sidebar.setRemoteUpdatedNotifier(() => announced++);

    await sidebar.getSidebarModel();
    // Nothing to say yet — the model that just went out is local-only.
    expect(announced).toBe(0);

    settle(0, { feature: { id: 7 } });
    await flush();
    // Without this the first pull requests of a session would appear
    // whenever the renderer next polled, up to four seconds later.
    expect(announced).toBe(1);
  });

  it('stays quiet when the cache was already fresh', async () => {
    await sidebar.getSidebarModel();
    settle(0);
    await flush();

    let announced = 0;
    sidebar.setRemoteUpdatedNotifier(() => announced++);
    await sidebar.getSidebarModel();
    await flush();

    expect(env.fetchCount).toBe(1);
    expect(announced).toBe(0);
  });
});
