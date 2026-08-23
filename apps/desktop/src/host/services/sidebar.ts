import { readConfig } from '@kirby/vcs-core';
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

/**
 * Assemble the unified, ordered sidebar model exactly like the TUI's
 * SidebarProvider — worktrees, then draft PRs, then PRs, then the
 * three review buckets — by reusing app-core's pure builders. Runs in
 * the main process where git + provider access is available; the
 * result is plain data streamed to the renderer.
 *
 * Merge/conflict decorations (mergedBranches, conflictCounts) are
 * omitted for now — they only affect row annotations, not structure.
 */
export async function getSidebarModel(): Promise<SidebarItem[]> {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const provider = config.vendor
    ? PROVIDERS.find((p) => p.id === config.vendor) ?? null
    : null;

  const worktrees = await listWorktrees();
  const sessions: AgentSession[] = worktrees.map((wt) => {
    const name = worktreeSessionName(wt);
    return {
      name,
      running: isSessionAlive(name),
      ...(wt.state ? { state: wt.state } : {}),
    };
  });

  const configured =
    provider != null &&
    provider.isConfigured(config.vendorAuth, config.vendorProject);
  const prMap = configured
    ? await provider.fetchPullRequests(config.vendorAuth, config.vendorProject)
    : {};

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

  return buildSidebarItems(
    sortedSessions,
    orphanPrs,
    categorizedReviews,
    sessionBranchMap,
    sessionPrMap,
    new Set(),
    new Map()
  );
}
