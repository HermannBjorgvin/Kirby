import type { PullRequestInfo, CategorizedReviews } from '@kirby/vcs-core';
import type { AgentSession, SidebarItem } from '../types.js';

/**
 * Build a flat, ordered list of sidebar items from all data sources.
 *
 * Section order:
 * 1. Sessions (sorted by PR id descending, sessions without PRs last)
 * 2. Active orphan PRs (your PRs with no worktree session)
 * 3. Draft orphan PRs
 * 4. Needs review (others' PRs you need to review)
 * 5. Waiting for author
 * 6. Approved by you
 *
 * Section headers are NOT in the array — rendering determines them by
 * detecting kind/category transitions.
 */
export function buildSidebarItems(
  sortedSessions: AgentSession[],
  orphanPrs: PullRequestInfo[],
  categorizedReviews: CategorizedReviews,
  sessionBranchMap: Map<string, string>,
  sessionPrMap: Map<string, PullRequestInfo>,
  mergedBranches: Set<string>,
  conflictCounts: Map<string, number>
): SidebarItem[] {
  const items: SidebarItem[] = [];

  // 1. Sessions
  for (const session of sortedSessions) {
    const branch = sessionBranchMap.get(session.name);
    const pr = sessionPrMap.get(session.name);
    const isMerged = branch ? mergedBranches.has(branch) : false;
    const conflictCount = branch ? conflictCounts.get(branch) : undefined;
    items.push({ kind: 'session', session, pr, branch, isMerged, conflictCount });
  }

  // 2. Active orphan PRs
  const activeOrphanPrs = orphanPrs.filter((pr) => pr.isDraft !== true);
  for (const pr of activeOrphanPrs) {
    items.push({ kind: 'orphan-pr', pr });
  }

  // 3. Draft orphan PRs
  const draftOrphanPrs = orphanPrs.filter((pr) => pr.isDraft === true);
  for (const pr of draftOrphanPrs) {
    items.push({ kind: 'orphan-pr', pr });
  }

  // 4-6. Review PRs by category
  for (const pr of categorizedReviews.needsReview) {
    items.push({ kind: 'review-pr', pr, category: 'needs-review' });
  }
  for (const pr of categorizedReviews.waitingForAuthor) {
    items.push({ kind: 'review-pr', pr, category: 'waiting' });
  }
  for (const pr of categorizedReviews.approvedByYou) {
    items.push({ kind: 'review-pr', pr, category: 'approved' });
  }

  return items;
}
