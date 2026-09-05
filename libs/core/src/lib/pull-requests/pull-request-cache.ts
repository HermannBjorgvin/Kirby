/**
 * The pull request list, cached per repository.
 *
 * Everything that wants to know what the provider says about a
 * repository's pull requests — a sidebar polling every few seconds, a
 * babysitter asking about one row every minute — reads it from here,
 * so the provider is asked once per interval however many readers
 * there are. `prPollInterval` is the TTL; the TUI honours it verbatim,
 * so this does too.
 *
 * **One entry per repository, bounded.** The desktop's tab strip spans
 * repositories and following a foreign tab opens its repository, so a
 * user working across two checkouts switches back and forth all day.
 * A single slot made every switch a refetch of the other side — on a
 * provider that spends a request per pull request, that is what a
 * rate limit is made of. Past `MAX_CACHED_REPOS` the least recently
 * fetched entry goes, because a cache that never forgets is a leak
 * wearing a hat.
 *
 * **A reader never waits for the network unless it asks to.**
 * `cached` answers from memory and `refreshInBackground` starts a
 * fetch when one is due; the fetch announces itself through
 * `onCommitted` when it lands. `readPullRequests` awaits — for the
 * one caller watching a spinner they asked for, and for a watcher that
 * needs an answer rather than a snapshot.
 *
 * **Failure is remembered too.** A failed fetch keeps the last good
 * list on screen and is retried on the interval rather than on every
 * read: without that, a provider that is down gets a fresh request
 * from every sidebar poll — the exact burst this module exists to
 * avoid, aimed at a service that is already unhappy.
 *
 * **Only the newest fetch for a repository may commit.** A slow
 * response started before a forced refresh must not overwrite the
 * refresh's fresher data, and a fetch started under credentials that
 * have since been replaced must not land at all — nor be handed to
 * whoever joined it: a retired fetch answers with whatever the cache
 * holds now, which after a credential change is the post-clear state.
 */
import type {
  AppConfig,
  BranchPrMap,
  PullRequestInfo,
  VcsProvider,
} from '@kirby/vcs-core';

export const PULL_REQUEST_POLL_DEFAULT_MS = 60_000;

/**
 * How many repositories' pull requests to keep: enough to cover moving
 * between the checkouts one person has open at once.
 */
export const MAX_CACHED_REPOS = 8;

/** No minimum: `prPollInterval` is honoured verbatim. */
export function pullRequestPollIntervalMs(
  interval: number | undefined
): number {
  return interval ?? PULL_REQUEST_POLL_DEFAULT_MS;
}

/** The provider a repository is configured for, resolved per call so
 *  a credential or vendor change is seen on the next read. */
export interface ProviderResolution {
  config: AppConfig;
  provider: VcsProvider | null;
  configured: boolean;
}

/** The pull request as the provider has it now. `gone` is a merged or
 *  closed pull request; `unknown` is a provider that could not answer,
 *  which is not the same thing and must not end a watch. */
export type PullRequestLookup =
  | { kind: 'found'; pr: PullRequestInfo }
  | { kind: 'gone' }
  | { kind: 'unknown'; reason: string };

export interface PullRequestCacheState {
  /** Last *successful* fetch for this repository, or null. */
  fetchedAt: number | null;
  /** Why the last attempt failed, if it did. Per repository: a
   *  failure in the checkout the user just left must not be reported
   *  against the one they opened. */
  error: string | null;
  inflight: boolean;
  /** Every fetch this cache has started, for any repository — so "did
   *  the credential change actually trigger one?" is answerable
   *  without waiting to see whether it succeeded. */
  fetchCount: number;
}

export interface PullRequestCacheOptions {
  resolveProvider: (cwd: string) => ProviderResolution;
  /** A fetch landed and changed what `cached(cwd)` answers. */
  onCommitted?: (cwd: string) => void;
  now?: () => number;
}

export interface PullRequestCache {
  /** The list, fetched if the cache is past its TTL (or `force`).
   *  Never rejects: a failure serves the last good list and is
   *  reported through `getState`. */
  readPullRequests(
    cwd: string,
    opts?: { force?: boolean }
  ): Promise<BranchPrMap>;
  /** What the cache holds now, without going anywhere. */
  cached(cwd: string): BranchPrMap;
  /** Start a fetch if one is due and return without waiting for it. */
  refreshInBackground(cwd: string): void;
  /** One pull request as the cache has it, refreshed on the cache's
   *  own schedule. Absent from the list means merged or closed only
   *  when the list is an answer. */
  lookupPullRequest(cwd: string, prId: number): Promise<PullRequestLookup>;
  getState(cwd: string): PullRequestCacheState;
  /** The credentials changed: drop what the old ones fetched, for
   *  every repository, and go and find out whether the new ones work
   *  for `cwd`. */
  forgetCredentials(cwd: string): void;
  /** Test hook: forget everything. */
  reset(): void;
}

interface Entry {
  prMap: BranchPrMap;
  /** Last successful fetch. */
  fetchedAt: number;
  /** Last failure, if the last attempt failed. */
  failedAt?: number;
  error?: string;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createPullRequestCache(
  options: PullRequestCacheOptions
): PullRequestCache {
  const { resolveProvider, onCommitted, now = Date.now } = options;
  const cache = new Map<string, Entry>();
  const inflight = new Map<string, Promise<BranchPrMap>>();
  // Monotonic fetch id *per repository*: only the latest fetch for a
  // repository may commit. Per repository rather than global, or
  // switching away mid-fetch retires a fetch that was going to answer
  // correctly for the repository it was started for.
  const fetchSeq = new Map<string, number>();
  let fetchCount = 0;

  const cached = (cwd: string): BranchPrMap => cache.get(cwd)?.prMap ?? {};

  /** The entry, if asking again now would be pointless: the last
   *  answer is inside its TTL, or the last *attempt* failed inside it
   *  and the service deserves the interval before being asked again. */
  const fresh = (cwd: string, ttl: number): Entry | null => {
    const entry = cache.get(cwd);
    if (!entry) return null;
    const last = Math.max(entry.fetchedAt, entry.failedAt ?? 0);
    return now() - last < ttl ? entry : null;
  };

  /** Record a repository's list, evicting the stalest if the map is full. */
  const remember = (cwd: string, prMap: BranchPrMap): void => {
    cache.set(cwd, { prMap, fetchedAt: now() });
    while (cache.size > MAX_CACHED_REPOS) {
      let oldest: string | null = null;
      let oldestAt = Infinity;
      for (const [key, entry] of cache) {
        if (entry.fetchedAt < oldestAt) {
          oldestAt = entry.fetchedAt;
          oldest = key;
        }
      }
      if (oldest === null) break;
      cache.delete(oldest);
    }
  };

  const recordFailure = (cwd: string, err: unknown): void => {
    const previous = cache.get(cwd);
    cache.set(cwd, {
      prMap: previous?.prMap ?? {},
      fetchedAt: previous?.fetchedAt ?? 0,
      failedAt: now(),
      error: describe(err),
    });
  };

  const startFetch = (
    cwd: string,
    provider: VcsProvider,
    config: AppConfig
  ): Promise<BranchPrMap> => {
    const seq = (fetchSeq.get(cwd) ?? 0) + 1;
    fetchSeq.set(cwd, seq);
    fetchCount += 1;
    const current = () => seq === fetchSeq.get(cwd);
    const promise = provider
      .fetchPullRequests(config.vendorAuth, config.vendorProject)
      .then((prMap) => {
        if (!current()) return cached(cwd);
        remember(cwd, prMap);
        onCommitted?.(cwd);
        return prMap;
      })
      .catch((err: unknown) => {
        if (current()) recordFailure(cwd, err);
        // Serve stale data on failure rather than blanking the list.
        return cached(cwd);
      })
      .finally(() => {
        if (inflight.get(cwd) === promise) inflight.delete(cwd);
      });
    inflight.set(cwd, promise);
    return promise;
  };

  const readPullRequests = (
    cwd: string,
    opts: { force?: boolean } = {}
  ): Promise<BranchPrMap> => {
    const { config, provider, configured } = resolveProvider(cwd);
    if (!provider || !configured) {
      remember(cwd, {});
      return Promise.resolve({});
    }
    const ttl = pullRequestPollIntervalMs(config.prPollInterval);
    const entry = opts.force ? null : fresh(cwd, ttl);
    if (entry) return Promise.resolve(entry.prMap);
    // Join an in-flight fetch unless the caller is forcing a refresh —
    // a forced one starts its own request so it cannot resolve
    // against a pre-change response.
    const joinable = inflight.get(cwd);
    if (joinable && !opts.force) return joinable;
    return startFetch(cwd, provider, config);
  };

  const lookupPullRequest = async (
    cwd: string,
    prId: number
  ): Promise<PullRequestLookup> => {
    const { provider, configured } = resolveProvider(cwd);
    if (!provider || !configured) {
      return { kind: 'unknown', reason: 'No provider is configured' };
    }
    const prMap = await readPullRequests(cwd);
    const pr = Object.values(prMap).find((entry) => entry?.id === prId);
    if (pr) return { kind: 'found', pr };
    const entry = cache.get(cwd);
    if (!entry || entry.error) {
      return {
        kind: 'unknown',
        reason: entry?.error ?? 'The pull request list has not loaded',
      };
    }
    return { kind: 'gone' };
  };

  return {
    readPullRequests,
    cached,
    refreshInBackground: (cwd) => {
      void readPullRequests(cwd);
    },
    lookupPullRequest,
    getState: (cwd) => ({
      fetchedAt: cache.get(cwd)?.fetchedAt || null,
      error: cache.get(cwd)?.error ?? null,
      inflight: inflight.has(cwd),
      fetchCount,
    }),
    forgetCredentials: (cwd) => {
      // Every repository, not just this one: the token is global, so a
      // replaced one invalidates what any of them fetched.
      cache.clear();
      inflight.clear();
      // Retire every fetch already in the air, whichever repo it was for.
      for (const [key, seq] of fetchSeq) fetchSeq.set(key, seq + 1);
      void readPullRequests(cwd, { force: true });
    },
    reset: () => {
      cache.clear();
      inflight.clear();
      fetchSeq.clear();
      fetchCount = 0;
    },
  };
}
