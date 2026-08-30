import { readConfig, type BranchPrMap } from '@kirby/vcs-core';
import { listWorktrees, worktreeSessionName } from '@kirby/worktree-manager';
import {
  isSessionAlive,
  buildSidebarItems,
  buildSessionLookups,
  categorizeReviews,
  findOrphanPrs,
  sortSessionsByPrId,
  type AgentSession,
  type SidebarItem,
} from '@kirby/core';
import { PROVIDERS, requireRepo } from './repo.js';
import { getSyncDecorations } from './remote-sync.js';
import type { SyncState } from '../contract.js';

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

interface RemoteCache {
  cwd: string;
  prMap: BranchPrMap;
  fetchedAt: number;
}

let cache: RemoteCache | null = null;
let inflight: { cwd: string; promise: Promise<BranchPrMap> } | null = null;
let lastError: string | null = null;
// Monotonic fetch id: only the latest fetch may commit to the cache,
// so a slow pre-refresh response can't overwrite a forced refresh's
// fresher data with a fresh timestamp.
let fetchSeq = 0;

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
  return cache && cache.cwd === cwd ? cache.prMap : {};
}

/** The cache, if it is this repo's and still inside its TTL. */
function freshCache(cwd: string, ttl: number): RemoteCache | null {
  if (!cache || cache.cwd !== cwd) return null;
  return Date.now() - cache.fetchedAt < ttl ? cache : null;
}

async function fetchRemote(
  cwd: string,
  force = false,
  onCommit?: () => void
): Promise<BranchPrMap> {
  const { config, provider, configured } = resolveProvider(cwd);
  if (!provider || !configured) {
    cache = { cwd, prMap: {}, fetchedAt: Date.now() };
    lastError = null;
    return {};
  }
  const fresh = force
    ? null
    : freshCache(cwd, remoteIntervalMs(config.prPollInterval));
  if (fresh) return fresh.prMap;
  // Join an in-flight fetch only when it is for this repo and the
  // caller isn't forcing a refresh — a forced refresh (or a repo
  // switch mid-fetch) starts its own request so it can't resolve
  // against another repo's (or a pre-change) response.
  if (inflight && inflight.cwd === cwd && !force) return inflight.promise;
  const seq = ++fetchSeq;
  const promise = provider
    .fetchPullRequests(config.vendorAuth, config.vendorProject)
    .then((prMap) => {
      if (seq === fetchSeq) {
        cache = { cwd, prMap, fetchedAt: Date.now() };
        lastError = null;
        onCommit?.();
      }
      return prMap;
    })
    .catch((err: unknown) => {
      if (seq === fetchSeq) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      // Serve stale data on failure rather than blanking the sidebar.
      if (cache && cache.cwd === cwd) return cache.prMap;
      return {};
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  inflight = { cwd, promise };
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
      running: isSessionAlive(name),
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

export function getSyncState(): SyncState {
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  return {
    providerId: provider?.id ?? null,
    providerConfigured: configured,
    lastRemoteSyncAt: cache && cache.cwd === cwd ? cache.fetchedAt : null,
    lastGitSyncAt: getSyncDecorations().lastGitSyncAt,
    remoteError: lastError,
    remoteSyncing: inflight !== null,
    remoteIntervalMs: remoteIntervalMs(config.prPollInterval),
  };
}

export async function refreshRemote(): Promise<void> {
  const cwd = requireRepo();
  await fetchRemote(cwd, true);
}

/** Test hook: forget cached remote data. */
export function resetRemoteCache(): void {
  cache = null;
  inflight = null;
  lastError = null;
}
