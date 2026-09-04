/**
 * The host's instance of `@kirby/core`'s pull request cache, and the
 * provider it resolves through.
 *
 * Every host-side reader of the pull request list sits on this one
 * instance: the sidebar model, the babysitters (one row each, every
 * minute) and the sync loop's conflict counts, which need to know a
 * branch's target. One instance is what keeps a watched row from
 * costing the provider a fetch of its own.
 */
import {
  createPullRequestCache,
  type ProviderResolution,
  type PullRequestLookup,
} from '@kirby/core';
import {
  readConfig,
  type BranchPrMap,
  type VcsProvider,
} from '@kirby/vcs-core';
import { PROVIDERS } from './repo.js';

// Installed by main.ts. Fires when a background fetch has changed what
// the sidebar would answer, so the renderer can refetch then rather
// than on its next poll tick.
let remoteUpdated: (() => void) | null = null;

export function setRemoteUpdatedNotifier(fn: (() => void) | null): void {
  remoteUpdated = fn;
}

/** Tell the renderer the remote data it shows has moved. */
export function notifyRemoteUpdated(): void {
  remoteUpdated?.();
}

export function resolveProvider(cwd: string): ProviderResolution {
  const config = readConfig(cwd);
  const provider = config.vendor
    ? PROVIDERS.find((p) => p.id === config.vendor) ?? null
    : null;
  const configured =
    provider != null &&
    provider.isConfigured(config.vendorAuth, config.vendorProject);
  return { config, provider, configured };
}

export const pullRequests = createPullRequestCache({
  resolveProvider,
  onCommitted: notifyRemoteUpdated,
});

/** The provider the repository at `cwd` is configured for, if any. */
export function repoProvider(cwd: string): VcsProvider | null {
  const { provider, configured } = resolveProvider(cwd);
  return configured ? provider : null;
}

/**
 * One pull request as the cache has it, refreshed on the cache's own
 * schedule — a babysitter asking every minute reads what the sidebar
 * reads, rather than costing the provider a fetch per watched row.
 */
export function lookupPullRequest(
  cwd: string,
  prId: number
): Promise<PullRequestLookup> {
  return pullRequests.lookupPullRequest(cwd, prId);
}

/** The list as cached for `cwd`, without waiting for anything. */
export function cachedPullRequests(cwd: string): BranchPrMap {
  return pullRequests.cached(cwd);
}
