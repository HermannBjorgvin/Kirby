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
} from '@kirby/app-core';
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

async function fetchRemote(cwd: string, force = false): Promise<BranchPrMap> {
  const { config, provider, configured } = resolveProvider(cwd);
  if (!provider || !configured) {
    cache = { cwd, prMap: {}, fetchedAt: Date.now() };
    lastError = null;
    return {};
  }
  const ttl = remoteIntervalMs(config.prPollInterval);
  if (
    !force &&
    cache &&
    cache.cwd === cwd &&
    Date.now() - cache.fetchedAt < ttl
  ) {
    return cache.prMap;
  }
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

export async function getSidebarModel(): Promise<SidebarItem[]> {
  const cwd = requireRepo();
  const { config, provider } = resolveProvider(cwd);

  const [worktrees, prMap] = await Promise.all([
    listWorktrees(),
    fetchRemote(cwd),
  ]);
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
