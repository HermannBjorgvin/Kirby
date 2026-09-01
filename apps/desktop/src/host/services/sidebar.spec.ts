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
  /** When set, the next worktree listing waits until it is called. */
  releaseWorktrees: null as (() => void) | null,
  holdWorktrees: false,
  /** Resolvers for each provider fetch, in call order. */
  pending: [] as {
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
  }[],
  fetchCount: 0,
  forgetCount: 0,
  now: 1_000_000,
  /** Last sessionBranchMap handed to buildSidebarItems. */
  lastBranchMap: new Map<string, string>(),
}));

vi.mock('./repo.js', () => ({
  requireRepo: () => env.cwd,
  activeRepoIs: (cwd: string) => cwd === env.cwd,
  PROVIDERS: [
    {
      id: 'github',
      isConfigured: () => env.configured,
      forgetPullRequestCache: () => {
        env.forgetCount += 1;
      },
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
  listWorktrees: () =>
    env.holdWorktrees
      ? new Promise<typeof env.worktrees>((resolve) => {
          env.holdWorktrees = false;
          env.releaseWorktrees = () => resolve(env.worktrees);
        })
      : Promise.resolve(env.worktrees),
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
  env.holdWorktrees = false;
  env.releaseWorktrees = null;
  env.pending = [];
  env.fetchCount = 0;
  env.forgetCount = 0;
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

  /**
   * A provider may hold per-row answers well past one response — Azure
   * remembers a settled CI verdict for ten minutes — so the difference
   * between "poll again" and "the user asked" has to reach it.
   */
  describe('refreshing', () => {
    it('tells the provider to forget when the user asks', async () => {
      const forced = sidebar.refreshRemote();
      await flush();
      settle(0);
      await forced;
      expect(env.forgetCount).toBe(1);
    });

    it('does not, for a re-read the app asked for itself', async () => {
      // Submitting a review verdict changes the reviewer votes, which
      // come from the list. It changes no CI verdict and no comment
      // count, so making the provider cold again would spend a cycle's
      // worth of requests for nothing.
      const quiet = sidebar.refreshPrList();
      await flush();
      settle(0);
      await quiet;
      expect(env.forgetCount).toBe(0);
      expect(env.fetchCount).toBe(1);
    });
  });

  it('waits out the interval after a failure instead of retrying every poll', async () => {
    // A failed fetch caches nothing, so the renderer's four-second
    // sidebar poll used to start a fresh cycle every time — a burst
    // aimed at a service that is already unhappy.
    const bad = sidebar.getSidebarModel();
    await flush();
    env.pending[0].reject(new Error('provider down'));
    await bad;
    await flush();
    expect(env.fetchCount).toBe(1);

    env.now += 4_000;
    await sidebar.getSidebarModel();
    await flush();
    expect(env.fetchCount).toBe(1);

    env.now += 57_000; // past the 60s interval
    const retry = sidebar.getSidebarModel();
    await flush();
    expect(env.fetchCount).toBe(2);
    settle(1);
    await retry;
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

/**
 * The tab strip spans repositories, and following a foreign tab opens
 * its repository — so a user working across two checkouts switches back
 * and forth all day. A cache with one slot made every switch a full
 * refetch of the other side, which on a provider that spends a request
 * per pull request is where a rate limit comes from.
 */
describe('across repositories', () => {
  /** Fetch and settle one repo's pull requests. */
  async function sync(cwd: string, value: Record<string, unknown>) {
    env.cwd = cwd;
    const model = sidebar.getSidebarModel();
    await flush();
    settle(env.fetchCount - 1, value);
    await model;
  }

  it('does not refetch a repo it has already fetched when coming back', async () => {
    await sync('/repo-a', { a: 1 });
    await sync('/repo-b', { b: 1 });
    expect(env.fetchCount).toBe(2);

    // Back to the first, inside its TTL: the answer is already here.
    env.cwd = '/repo-a';
    await sidebar.getSidebarModel();
    await flush();
    expect(env.fetchCount).toBe(2);
  });

  it('keeps each repo’s last-sync time separately', async () => {
    await sync('/repo-a', {});
    env.now += 10_000;
    await sync('/repo-b', {});

    env.cwd = '/repo-a';
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBe(1_000_000);
    env.cwd = '/repo-b';
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBe(1_010_000);
  });

  it('lets a fetch land for the repo it was started for, after a switch', async () => {
    // Switching away used to retire the in-flight fetch, so the repo it
    // was for ended up with nothing cached and refetched on return.
    env.cwd = '/repo-a';
    const slow = sidebar.getSidebarModel();
    await flush();

    env.cwd = '/repo-b';
    const other = sidebar.getSidebarModel();
    await flush();
    settle(1, { b: 1 });
    await other;

    settle(0, { a: 1 });
    await slow;

    env.cwd = '/repo-a';
    expect(sidebar.getSyncState().lastRemoteSyncAt).not.toBeNull();
    await sidebar.getSidebarModel();
    await flush();
    expect(env.fetchCount).toBe(2);
  });

  it('reports only this repo as syncing while another one fetches', async () => {
    env.cwd = '/repo-a';
    const slow = sidebar.getSidebarModel();
    await flush();
    expect(sidebar.getSyncState().remoteSyncing).toBe(true);

    env.cwd = '/repo-b';
    expect(sidebar.getSyncState().remoteSyncing).toBe(false);

    env.cwd = '/repo-a';
    settle(0);
    await slow;
  });

  it('never evicts the repository the user is looking at', async () => {
    // Eviction is by fetch time, and the active repo is the only one
    // being fetched — so it is always the newest. Pinned because the
    // alternative (evicting it) empties the sidebar the user is
    // watching.
    await sync('/repo-active', {});
    for (let i = 0; i < 8; i++) {
      env.now += 1_000;
      await sync(`/repo-other-${i}`, {});
      env.now += 1_000;
      await sync('/repo-active', {});
    }
    env.cwd = '/repo-active';
    expect(sidebar.getSyncState().lastRemoteSyncAt).not.toBeNull();
  });

  it('forgets the least recently fetched repo rather than growing forever', async () => {
    for (let i = 0; i < 9; i++) {
      env.now += 1_000;
      await sync(`/repo-${i}`, {});
    }
    expect(env.fetchCount).toBe(9);

    // The ninth eviction takes the first repo; the second is still here.
    env.cwd = '/repo-1';
    expect(sidebar.getSyncState().lastRemoteSyncAt).not.toBeNull();
    env.cwd = '/repo-0';
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBeNull();
  });

  it('keeps a failure to the repo it happened in', async () => {
    env.cwd = '/repo-a';
    const bad = sidebar.getSidebarModel();
    await flush();

    // The user follows a foreign tab while A's fetch is still in the
    // air, and it fails. Reporting that against B would blame the
    // wrong checkout — and B's fetch may have gone perfectly.
    env.cwd = '/repo-b';
    env.pending[0].reject(new Error('rejected the access token'));
    await bad;
    await flush();

    expect(sidebar.getSyncState().remoteError).toBeNull();
    env.cwd = '/repo-a';
    expect(sidebar.getSyncState().remoteError).toContain('access token');
  });

  it('reports the repo the user is looking at as never synced, not stale', async () => {
    // A repo whose only attempt failed has no sync time to report; the
    // failure timestamp is not one.
    env.cwd = '/repo-a';
    const bad = sidebar.getSidebarModel();
    await flush();
    env.pending[0].reject(new Error('nope'));
    await bad;
    await flush();
    expect(sidebar.getSyncState().lastRemoteSyncAt).toBeNull();
  });

  it('drops every repo’s cache when the credentials change', async () => {
    await sync('/repo-a', {});
    await sync('/repo-b', {});

    env.cwd = '/repo-a';
    sidebar.onCredentialsChanged();
    await flush();

    // The token is global, so what the other checkout fetched was
    // fetched as somebody else too.
    env.cwd = '/repo-b';
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

describe('getSidebarSnapshot', () => {
  it('stamps the rows with the repository they describe', async () => {
    env.worktrees = [{ branch: 'feature' }];
    const snapshot = await sidebar.getSidebarSnapshot();
    expect(snapshot.cwd).toBe('/repo-a');
    expect(snapshot.items).toHaveLength(1);
  });

  it('answers for the repository the host is on once a switch lands mid-call', async () => {
    // The worktree list is where the call awaits; the host moves to
    // another repository while it is out. Stamping the rows that come
    // back with either repo would be wrong — they were listed under
    // one and had their sessions judged under the other — so the
    // snapshot is the new repository's, computed whole.
    env.worktrees = [{ branch: 'from-a' }];
    env.holdWorktrees = true;
    const pending = sidebar.getSidebarSnapshot();
    await flush();
    env.cwd = '/repo-b';
    env.worktrees = [{ branch: 'from-b' }];
    env.releaseWorktrees?.();
    const snapshot = await pending;
    expect(snapshot.cwd).toBe('/repo-b');
    expect(snapshot.items).toEqual([
      expect.objectContaining({ name: 'from-b' }),
    ]);
  });
});
