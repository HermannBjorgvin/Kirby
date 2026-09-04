import { beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig, BranchPrMap, VcsProvider } from '@kirby/vcs-core';
import {
  createPullRequestCache,
  type PullRequestCache,
} from './pull-request-cache.js';

/**
 * Two readers sit on this cache — a sidebar polling every few seconds
 * and a babysitter asking about one row every minute — so the subtle
 * failures are the ones between calls: a forced refresh joining a
 * stale in-flight request, a slow response committing over a fresher
 * one, a fetch started under credentials that were replaced while it
 * was out, or a fetch started before a repo switch landing in the
 * wrong entry.
 */

interface Pending {
  resolve: (v: BranchPrMap) => void;
  reject: (e: Error) => void;
}

let now: number;
let pending: Pending[];
let configured: boolean;
let config: Partial<AppConfig>;
let committed: string[];
let cache: PullRequestCache;

const provider = {
  id: 'github',
  isConfigured: () => configured,
  fetchPullRequests: () =>
    new Promise<BranchPrMap>((resolve, reject) => {
      pending.push({ resolve, reject });
    }),
} as unknown as VcsProvider;

/** Settle the promise chain without advancing the clock. */
async function flush(times = 4) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Resolve the nth outstanding provider fetch. */
function settle(index = 0, value: BranchPrMap = {}) {
  pending[index].resolve(value);
}

const fetchCount = () => cache.getState('/any').fetchCount;

beforeEach(() => {
  now = 1_000_000;
  pending = [];
  configured = true;
  config = {};
  committed = [];
  cache = createPullRequestCache({
    resolveProvider: () => ({
      config: { vendor: 'github', ...config } as AppConfig,
      provider,
      configured,
    }),
    onCommitted: (cwd) => committed.push(cwd),
    now: () => now,
  });
});

describe('the TTL', () => {
  it('serves the cache inside the TTL and refetches after it', async () => {
    const first = cache.readPullRequests('/a', { force: true });
    await flush();
    settle(0, { a: null });
    await first;
    expect(fetchCount()).toBe(1);

    now += 30_000; // default TTL is 60s
    await cache.readPullRequests('/a');
    expect(fetchCount()).toBe(1);

    now += 31_000;
    const later = cache.readPullRequests('/a');
    await flush();
    settle(1, { a: null });
    await later;
    expect(fetchCount()).toBe(2);
  });

  it('honours prPollInterval as the TTL', async () => {
    config = { prPollInterval: 5_000 };
    const first = cache.readPullRequests('/a', { force: true });
    await flush();
    settle(0);
    await first;

    now += 6_000;
    const second = cache.readPullRequests('/a');
    await flush();
    settle(1);
    await second;
    expect(fetchCount()).toBe(2);
  });

  it('waits out the interval after a failure instead of retrying every read', async () => {
    // A failed fetch caches nothing, so a four-second sidebar poll
    // would otherwise start a fresh cycle every time — a burst aimed
    // at a service that is already unhappy.
    const bad = cache.readPullRequests('/a');
    await flush();
    pending[0].reject(new Error('provider down'));
    await bad;
    expect(fetchCount()).toBe(1);

    now += 4_000;
    await cache.readPullRequests('/a');
    expect(fetchCount()).toBe(1);

    now += 57_000; // past the 60s interval
    const retry = cache.readPullRequests('/a');
    await flush();
    expect(fetchCount()).toBe(2);
    settle(1);
    await retry;
  });

  it('does not call the provider at all when it is not configured', async () => {
    configured = false;
    expect(await cache.readPullRequests('/a')).toEqual({});
    expect(fetchCount()).toBe(0);
  });
});

describe('concurrent reads', () => {
  it('collapses concurrent reads into one provider request', async () => {
    const a = cache.readPullRequests('/a');
    const b = cache.readPullRequests('/a');
    await flush();
    expect(fetchCount()).toBe(1);
    settle(0);
    await Promise.all([a, b]);
  });

  it('gives a forced refresh its own request rather than a stale one', async () => {
    const poll = cache.readPullRequests('/a');
    await flush();
    expect(fetchCount()).toBe(1);

    // Joining the in-flight request would answer the user's explicit
    // refresh with data fetched before they asked.
    const forced = cache.readPullRequests('/a', { force: true });
    await flush();
    expect(fetchCount()).toBe(2);

    settle(0);
    settle(1);
    await Promise.all([poll, forced]);
  });

  it('lets the newest fetch win when an older one lands last', async () => {
    const poll = cache.readPullRequests('/a', { force: true });
    await flush();
    const forced = cache.readPullRequests('/a', { force: true });
    await flush();

    // Newer request answers first, then the older one arrives.
    now = 2_000_000;
    settle(1, { fresh: null });
    await forced;
    now = 3_000_000;
    settle(0, { stale: null });
    // The stale response must not overwrite the cache — nor stamp it
    // with a newer timestamp, which would hide the staleness — and
    // whoever awaited it is handed what the cache holds, not the
    // response that was refused.
    expect(await poll).toEqual({ fresh: null });
    expect(cache.getState('/a').fetchedAt).toBe(2_000_000);
    expect(cache.cached('/a')).toEqual({ fresh: null });
  });

  it('reports a fetch as in flight until it settles', async () => {
    const read = cache.readPullRequests('/a');
    await flush();
    expect(cache.getState('/a').inflight).toBe(true);
    settle(0);
    await read;
    expect(cache.getState('/a').inflight).toBe(false);
  });
});

describe('failure', () => {
  it('keeps serving the last good data when a fetch fails', async () => {
    const ok = cache.readPullRequests('/a', { force: true });
    await flush();
    settle(0, { a: null });
    await ok;

    const bad = cache.readPullRequests('/a', { force: true });
    await flush();
    pending[1].reject(new Error('provider exploded'));
    // Blanking the list on a transient API error would be worse than
    // showing data a minute old.
    expect(await bad).toEqual({ a: null });
    const state = cache.getState('/a');
    expect(state.error).toBe('provider exploded');
    expect(state.fetchedAt).toBe(1_000_000);
  });

  it('clears a previous error once a fetch succeeds', async () => {
    const bad = cache.readPullRequests('/a', { force: true });
    await flush();
    pending[0].reject(new Error('nope'));
    await bad;
    expect(cache.getState('/a').error).toBe('nope');

    const good = cache.readPullRequests('/a', { force: true });
    await flush();
    settle(1);
    await good;
    expect(cache.getState('/a').error).toBeNull();
  });

  it('reports a repo whose only attempt failed as never fetched, not stale', async () => {
    const bad = cache.readPullRequests('/a');
    await flush();
    pending[0].reject(new Error('nope'));
    await bad;
    expect(cache.getState('/a').fetchedAt).toBeNull();
  });
});

describe('announcing', () => {
  it('announces a fetch when it commits, naming the repository', async () => {
    cache.refreshInBackground('/a');
    expect(committed).toEqual([]);
    settle(0, { feature: null });
    await flush();
    expect(committed).toEqual(['/a']);
  });

  it('stays quiet when the cache was already fresh', async () => {
    cache.refreshInBackground('/a');
    settle(0);
    await flush();
    committed.length = 0;
    cache.refreshInBackground('/a');
    await flush();
    expect(fetchCount()).toBe(1);
    expect(committed).toEqual([]);
  });
});

/**
 * Replacing a rejected access token has to look like it worked. The
 * cache still holds what the old credentials fetched, and the error
 * on file describes a state that no longer exists.
 */
describe('after the credentials change', () => {
  it('clears the error and fetches without waiting for the TTL', async () => {
    const bad = cache.readPullRequests('/a', { force: true });
    await flush();
    pending[0].reject(new Error('rejected the access token'));
    await bad;
    expect(cache.getState('/a').error).toContain('access token');

    cache.forgetCredentials('/a');
    // Cleared before the attempt, not after it: leaving the old
    // message up is what makes a correct fix look like it has not
    // taken.
    expect(cache.getState('/a').error).toBeNull();
    await flush();
    expect(fetchCount()).toBe(2);
    settle(1, { a: null });
  });

  it('does not serve what the old credentials fetched', async () => {
    const first = cache.readPullRequests('/a', { force: true });
    await flush();
    settle(0, { a: null });
    await first;
    expect(fetchCount()).toBe(1);

    cache.forgetCredentials('/a');
    await flush();
    // Inside the TTL, so without dropping the cache this would have
    // answered from data fetched as somebody else.
    expect(fetchCount()).toBe(2);
    settle(1, { a: null });
  });

  it('drops every repository, not just the one that was open', async () => {
    await sync('/a', {});
    await sync('/b', {});

    cache.forgetCredentials('/a');
    await flush();
    // The token is global, so what the other checkout fetched was
    // fetched as somebody else too.
    expect(cache.getState('/b').fetchedAt).toBeNull();
    expect(cache.cached('/b')).toEqual({});
  });

  it('hands a reader that joined a retired fetch the post-clear cache, not the disowned list', async () => {
    const joined = cache.readPullRequests('/a');
    await flush();

    cache.forgetCredentials('/a');
    await flush();
    // The old credentials' response arrives after the clear. It must
    // neither land in the cache nor reach the reader that joined the
    // request before the change.
    settle(0, { old: null });
    expect(await joined).toEqual({});
    expect(cache.cached('/a')).toEqual({});
    expect(committed).toEqual([]);

    settle(1, { fresh: null });
    await flush();
    expect(cache.cached('/a')).toEqual({ fresh: null });
  });
});

/** Fetch and settle one repository's pull requests. */
async function sync(cwd: string, value: BranchPrMap) {
  const read = cache.readPullRequests(cwd);
  await flush();
  settle(fetchCount() - 1, value);
  await read;
}

/**
 * A user working across two checkouts switches back and forth all
 * day. A cache with one slot made every switch a full refetch of the
 * other side, which on a provider that spends a request per pull
 * request is where a rate limit comes from.
 */
describe('across repositories', () => {
  it('does not refetch a repo it has already fetched when coming back', async () => {
    await sync('/a', { a: null });
    await sync('/b', { b: null });
    expect(fetchCount()).toBe(2);

    // Back to the first, inside its TTL: the answer is already here.
    expect(await cache.readPullRequests('/a')).toEqual({ a: null });
    expect(fetchCount()).toBe(2);
  });

  it('keeps each repo’s state separately', async () => {
    await sync('/a', {});
    now += 10_000;
    await sync('/b', {});
    expect(cache.getState('/a').fetchedAt).toBe(1_000_000);
    expect(cache.getState('/b').fetchedAt).toBe(1_010_000);
    expect(cache.getState('/c').fetchedAt).toBeNull();
  });

  it('lets a fetch land for the repo it was started for, after a switch', async () => {
    // Retiring the in-flight fetch on a switch would leave the repo it
    // was for with nothing cached, to be refetched on return.
    const slow = cache.readPullRequests('/a');
    await flush();

    const other = cache.readPullRequests('/b');
    await flush();
    settle(1, { b: null });
    await other;

    settle(0, { a: null });
    await slow;

    expect(cache.getState('/a').fetchedAt).not.toBeNull();
    expect(await cache.readPullRequests('/a')).toEqual({ a: null });
    expect(fetchCount()).toBe(2);
  });

  it('reports only the repo that is fetching as in flight', async () => {
    const slow = cache.readPullRequests('/a');
    await flush();
    expect(cache.getState('/a').inflight).toBe(true);
    expect(cache.getState('/b').inflight).toBe(false);
    settle(0);
    await slow;
  });

  it('never evicts the repository being read', async () => {
    // Eviction is by fetch time, and the repo being read is always the
    // newest — the alternative empties the list the user is watching.
    await sync('/active', {});
    for (let i = 0; i < 8; i++) {
      now += 1_000;
      await sync(`/other-${i}`, {});
      now += 1_000;
      await sync('/active', {});
    }
    expect(cache.getState('/active').fetchedAt).not.toBeNull();
  });

  it('forgets the least recently fetched repo rather than growing forever', async () => {
    for (let i = 0; i < 9; i++) {
      now += 1_000;
      await sync(`/repo-${i}`, {});
    }
    expect(fetchCount()).toBe(9);
    // The ninth eviction takes the first repo; the second is still here.
    expect(cache.getState('/repo-1').fetchedAt).not.toBeNull();
    expect(cache.getState('/repo-0').fetchedAt).toBeNull();
  });

  it('keeps a failure to the repo it happened in', async () => {
    const bad = cache.readPullRequests('/a');
    await flush();
    pending[0].reject(new Error('rejected the access token'));
    await bad;
    expect(cache.getState('/b').error).toBeNull();
    expect(cache.getState('/a').error).toContain('access token');
  });
});

/**
 * A watcher asking about one pull request must be able to tell "it
 * merged" from "the provider could not say": the first ends the
 * watch, the second must not.
 */
describe('lookupPullRequest', () => {
  const list: BranchPrMap = {
    'feat/x': { id: 7, sourceBranch: 'feat/x' } as BranchPrMap[string],
  };

  it('finds a pull request by id in the cached list', async () => {
    await sync('/a', list);
    const found = await cache.lookupPullRequest('/a', 7);
    expect(found).toMatchObject({ kind: 'found', pr: { id: 7 } });
    expect(fetchCount()).toBe(1);
  });

  it('reports one missing from a loaded list as gone', async () => {
    await sync('/a', list);
    expect(await cache.lookupPullRequest('/a', 8)).toEqual({ kind: 'gone' });
  });

  it('cannot say when no provider is configured', async () => {
    configured = false;
    expect(await cache.lookupPullRequest('/a', 7)).toMatchObject({
      kind: 'unknown',
    });
    expect(fetchCount()).toBe(0);
  });

  it('cannot say while the last fetch failed', async () => {
    await sync('/a', list);
    now += 61_000;
    const stale = cache.lookupPullRequest('/a', 8);
    await flush();
    pending[1].reject(new Error('offline'));
    expect(await stale).toEqual({ kind: 'unknown', reason: 'offline' });
    // The one that is still listed is still found, from the stale list.
    now += 61_000;
    const found = cache.lookupPullRequest('/a', 7);
    await flush();
    pending[2].reject(new Error('offline'));
    expect(await found).toMatchObject({ kind: 'found' });
  });

  it('cannot say before the list has loaded', async () => {
    const lookup = cache.lookupPullRequest('/a', 7);
    await flush();
    pending[0].reject(new Error('first attempt failed'));
    expect(await lookup).toMatchObject({ kind: 'unknown' });
  });
});
