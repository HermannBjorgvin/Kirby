import { readConfig, type BranchPrMap } from '@kirby/vcs-core';
import { listWorktrees, worktreeSessionName } from '@kirby/worktree-manager';
import {
  buildSidebarItems,
  buildSessionLookups,
  categorizeReviews,
  findOrphanPrs,
  sortSessionsByPrId,
  type AgentSession,
  type SidebarItem,
} from '@kirby/core';
import { PROVIDERS, activeRepoIs, requireRepo } from './repo.js';
import { isOwnSessionAlive } from './sessions.js';
import { getSyncDecorations } from './remote-sync.js';
import type { SidebarModel, SyncState } from '../contract.js';

/**
 * Assemble the unified, ordered sidebar model exactly like the TUI's
 * SidebarProvider — worktrees, then draft PRs, then PRs, then the
 * three review buckets — by reusing app-core's pure builders. Runs in
 * the main process where git + provider access is available; the
 * result is plain data streamed to the renderer.
 *
 * Local state (worktrees, alive PTYs) is cheap and re-read on every
 * call; remote PR data is cached here with a TTL so the renderer can
 * poll the model frequently without hammering the provider API. The
 * TUI's `prPollInterval` config drives the TTL.
 *
 * **The cache holds one entry per repository, not one entry.** The tab
 * strip spans repositories and following a foreign tab opens its
 * repository, so a user working across two checkouts switches back and
 * forth constantly. A single slot meant every switch evicted the
 * other repository's pull requests and refetched them from scratch —
 * on Azure DevOps, where a cycle costs a request per pull request,
 * that is what a rate limit is made of. Entries are bounded and the
 * least recently fetched is dropped, so the map cannot grow with every
 * repository ever opened.
 *
 * **The model never waits for the network.** A cold start has no
 * cached pull requests, and awaiting them here meant the sidebar — the
 * whole left half of the window, including worktrees git could have
 * listed in milliseconds — stayed empty until GitHub answered. So a
 * call serves whatever remote data exists (possibly none), starts a
 * fetch if one is due, and the fetch announces itself when it lands;
 * the renderer refetches on that event rather than waiting out its
 * poll interval. Only an explicit refresh, where the user is watching
 * a spinner they asked for, still awaits.
 *
 * Merge/conflict decorations (mergedBranches, conflictCounts) come
 * from the host's remote sync loop (services/remote-sync.ts).
 */

const DEFAULT_REMOTE_MS = 60_000;

/**
 * How many repositories' pull requests to keep. Enough to cover moving
 * between the checkouts one person has open at once; past that the
 * least recently fetched goes, because a cache that never forgets is a
 * leak wearing a hat.
 */
const MAX_CACHED_REPOS = 8;

interface RemoteCache {
  prMap: BranchPrMap;
  /** Last *successful* sync — what the status bar reports. */
  fetchedAt: number;
  /**
   * Last failure, if the last attempt failed. Held so a provider that
   * is down is retried on the poll interval rather than on every call:
   * without it a failed fetch leaves nothing cached, so the renderer's
   * four-second sidebar poll starts a fresh cycle every time — the
   * exact burst this file exists to avoid, aimed at a service that is
   * already unhappy.
   */
  failedAt?: number;
  /** Why, for the status bar. Per repo: a failure in the checkout the
   *  user just left must not be reported against the one they opened. */
  error?: string;
}

const cache = new Map<string, RemoteCache>();
const inflight = new Map<string, Promise<BranchPrMap>>();
// Monotonic fetch id *per repository*: only the latest fetch for a repo
// may commit its result, so a slow pre-refresh response can't overwrite
// a forced refresh's fresher data with a fresh timestamp. Per repo
// rather than global, or switching away mid-fetch retires a fetch that
// was going to answer correctly for the repo it was started for — and
// switching back then has nothing cached.
const fetchSeq = new Map<string, number>();
// Every fetch this process has started. Reported in the sync state so
// "did the credential change actually trigger one?" is answerable
// without waiting to see whether it succeeded.
let fetchCount = 0;

// Installed by main.ts. Fires when a background fetch has changed what
// getSidebarModel() would answer, so the renderer can refetch then
// rather than on its next poll tick.
let remoteUpdated: (() => void) | null = null;

export function setRemoteUpdatedNotifier(fn: (() => void) | null): void {
  remoteUpdated = fn;
}

// No minimum: the TUI honors prPollInterval verbatim, so the desktop's
// cache TTL does too.
function remoteIntervalMs(interval: number | undefined): number {
  return interval ?? DEFAULT_REMOTE_MS;
}

function resolveProvider(cwd: string) {
  const config = readConfig(cwd);
  const provider = config.vendor
    ? PROVIDERS.find((p) => p.id === config.vendor) ?? null
    : null;
  const configured =
    provider != null &&
    provider.isConfigured(config.vendorAuth, config.vendorProject);
  return { config, provider, configured };
}

/** What the cache can answer right now, without going anywhere. */
function cachedPrMap(cwd: string): BranchPrMap {
  return cache.get(cwd)?.prMap ?? {};
}

/**
 * The cache for this repo, if asking again now would be pointless: the
 * last answer is inside its TTL, or the last *attempt* failed inside it
 * and the service deserves the interval before being asked again.
 */
function freshCache(cwd: string, ttl: number): RemoteCache | null {
  const entry = cache.get(cwd);
  if (!entry) return null;
  const last = Math.max(entry.fetchedAt, entry.failedAt ?? 0);
  return Date.now() - last < ttl ? entry : null;
}

/** Record a repo's pull requests, evicting the stalest if the map is full. */
function remember(cwd: string, prMap: BranchPrMap): void {
  cache.set(cwd, { prMap, fetchedAt: Date.now() });
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
}

async function fetchRemote(
  cwd: string,
  force = false,
  onCommit?: () => void
): Promise<BranchPrMap> {
  const { config, provider, configured } = resolveProvider(cwd);
  if (!provider || !configured) {
    remember(cwd, {});
    return {};
  }
  const fresh = force
    ? null
    : freshCache(cwd, remoteIntervalMs(config.prPollInterval));
  if (fresh) return fresh.prMap;
  // Join an in-flight fetch for this repo unless the caller is forcing
  // a refresh — a forced one starts its own request so it cannot
  // resolve against a pre-change response.
  const joinable = inflight.get(cwd);
  if (joinable && !force) return joinable;
  const seq = (fetchSeq.get(cwd) ?? 0) + 1;
  fetchSeq.set(cwd, seq);
  fetchCount += 1;
  const promise = provider
    .fetchPullRequests(config.vendorAuth, config.vendorProject)
    .then((prMap) => {
      if (seq === fetchSeq.get(cwd)) {
        remember(cwd, prMap);
        onCommit?.();
      }
      return prMap;
    })
    .catch((err: unknown) => {
      const previous = cache.get(cwd);
      if (seq === fetchSeq.get(cwd)) {
        cache.set(cwd, {
          prMap: previous?.prMap ?? {},
          fetchedAt: previous?.fetchedAt ?? 0,
          failedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Serve stale data on failure rather than blanking the sidebar.
      return previous?.prMap ?? {};
    })
    .finally(() => {
      if (inflight.get(cwd) === promise) inflight.delete(cwd);
    });
  inflight.set(cwd, promise);
  return promise;
}

/**
 * Start a remote fetch if one is due, and return without waiting for
 * it. Announces itself when it commits so the renderer can pick the
 * new data up immediately.
 */
function refreshRemoteInBackground(cwd: string): void {
  void fetchRemote(cwd, false, () => remoteUpdated?.()).catch(() => {
    // fetchRemote never rejects — it serves stale data and records
    // lastError instead — but a rejection here must not become an
    // unhandled one that takes the main process down.
  });
}

export async function getSidebarModel(): Promise<SidebarItem[]> {
  const cwd = requireRepo();
  const { config, provider } = resolveProvider(cwd);

  // Local git first and on its own: worktrees are the rows the user is
  // most likely looking for, and they must not queue behind a provider
  // call that may be a network round trip away.
  refreshRemoteInBackground(cwd);
  const worktrees = await listWorktrees();
  const prMap = cachedPrMap(cwd);
  const sessions: AgentSession[] = worktrees.map((wt) => {
    const name = worktreeSessionName(wt);
    return {
      name,
      running: isOwnSessionAlive(name),
      ...(wt.state ? { state: wt.state } : {}),
    };
  });

  const sessionNames = new Set(sessions.map((s) => s.name));
  const orphanPrs = provider
    ? findOrphanPrs(prMap, sessionNames, config, provider)
    : [];
  const categorizedReviews = provider
    ? categorizeReviews(prMap, config, provider)
    : { needsReview: [], waitingForAuthor: [], approvedByYou: [] };
  const { sessionBranchMap, sessionPrMap } = buildSessionLookups(prMap);
  // buildSessionLookups only knows branches that have a PR; worktrees
  // without one would fall back to the sanitized session name for
  // display. Seed the map with each worktree's real branch so rows
  // show `feat/foo` rather than `feat-foo`.
  for (const wt of worktrees) {
    const name = worktreeSessionName(wt);
    if (wt.branch && !sessionBranchMap.has(name)) {
      sessionBranchMap.set(name, wt.branch);
    }
  }
  const sortedSessions = sortSessionsByPrId(sessions, sessionPrMap);

  // Merged/conflict decorations come from the host's remote sync loop
  // (same shared passes the TUI's hooks drive).
  const sync = getSyncDecorations();
  return buildSidebarItems(
    sortedSessions,
    orphanPrs,
    categorizedReviews,
    sessionBranchMap,
    sessionPrMap,
    sync.merged,
    sync.conflicts
  );
}

/**
 * The sidebar stamped with the repository it describes — what the
 * renderer is handed.
 *
 * `getSidebarModel` reads the open repository more than once over its
 * awaits (the worktree list, then which sessions are this repo's), so a
 * switch landing in between yields rows of one repository with the
 * live state of another. Rather than stamp that, it is computed again
 * for the repository the host is on now, and stamped with that one; the
 * renderer then knows exactly which workspace the answer is for. Bounded,
 * because a host that keeps switching under the call has a bigger
 * problem than a stale sidebar.
 */
export async function getSidebarSnapshot(): Promise<SidebarModel> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cwd = requireRepo();
    const items = await getSidebarModel();
    if (activeRepoIs(cwd)) return { cwd, items };
  }
  throw new Error('The open repository kept changing while listing it');
}

export function getSyncState(): SyncState {
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  return {
    providerId: provider?.id ?? null,
    providerConfigured: configured,
    lastRemoteSyncAt: cache.get(cwd)?.fetchedAt || null,
    lastGitSyncAt: getSyncDecorations().lastGitSyncAt,
    remoteError: cache.get(cwd)?.error ?? null,
    remoteSyncing: inflight.has(cwd),
    remoteIntervalMs: remoteIntervalMs(config.prPollInterval),
    remoteFetches: fetchCount,
  };
}

/**
 * The user pressed refresh.
 *
 * Deeper than a poll on purpose: a provider may hold per-row answers
 * well beyond one response — Azure remembers a settled CI verdict for
 * ten minutes — and answering a button from memory is what makes the
 * button look broken. Pressing it says "I think something has changed".
 */
export async function refreshRemote(): Promise<void> {
  const cwd = requireRepo();
  const { config, provider } = resolveProvider(cwd);
  provider?.forgetPullRequestCache?.(config.vendorProject);
  await fetchRemote(cwd, true);
}

/**
 * Re-read the pull request list now, without telling the provider to
 * forget anything.
 *
 * For the places the app itself knows something changed and knows what:
 * submitting a review verdict changes the reviewer votes, which come
 * from the list, and nothing a provider caches per row carries them.
 */
export async function refreshPrList(): Promise<void> {
  const cwd = requireRepo();
  await fetchRemote(cwd, true);
}

/**
 * The credentials changed: drop what the old ones fetched and go and
 * find out whether the new ones work.
 *
 * The error is cleared before the attempt rather than after it,
 * because it describes a state that no longer exists — leaving
 * "Azure DevOps rejected the access token" on screen after the token
 * has been replaced is what made a correct fix look like it had not
 * taken. If the new credentials are wrong too, the fetch says so
 * within a round trip.
 */
export function onCredentialsChanged(): void {
  const cwd = requireRepo();
  // Every repository, not just this one: `vendorAuth` is global, so a
  // replaced token invalidates what any of them fetched.
  cache.clear();
  inflight.clear();
  // Retire every fetch already in the air, whichever repo it was for.
  for (const [key, seq] of fetchSeq) fetchSeq.set(key, seq + 1);
  void fetchRemote(cwd, true, () => remoteUpdated?.()).catch(() => {
    // fetchRemote records failures in lastError rather than rejecting;
    // a rejection here must not take the main process down.
  });
  remoteUpdated?.();
}

/** Test hook: forget cached remote data. */
export function resetRemoteCache(): void {
  cache.clear();
  inflight.clear();
  fetchSeq.clear();
  fetchCount = 0;
}
