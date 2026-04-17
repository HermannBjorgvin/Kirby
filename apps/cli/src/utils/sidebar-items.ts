import type { PullRequestInfo, CategorizedReviews } from '@kirby/vcs-core';
import type { AgentSession, SidebarItem } from '../types.js';
import { branchToSessionName } from '@kirby/worktree-manager';

/**
 * Build a flat, ordered list of sidebar items from all data sources.
 *
 * Section order:
 * 1. Worktrees — sessions with no PR
 * 2. Draft Pull Requests — sessions with a draft PR, then draft orphan PRs
 * 3. Pull Requests — sessions with an active PR, then active orphan PRs
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

  // Collect review PR branches so we can exclude their sessions from the
  // sessions list (they appear in their review section with a running LED).
  const reviewBranches = new Set<string>();
  for (const pr of [
    ...categorizedReviews.needsReview,
    ...categorizedReviews.waitingForAuthor,
    ...categorizedReviews.approvedByYou,
  ]) {
    reviewBranches.add(pr.sourceBranch);
  }

  // Build a quick lookup: session name → AgentSession for review-pr running status
  const sessionByName = new Map(sortedSessions.map((s) => [s.name, s]));

  // Bucket sessions by PR status so each section can be emitted in order.
  const noPrSessions: SidebarItem[] = [];
  const draftPrSessions: SidebarItem[] = [];
  const activePrSessions: SidebarItem[] = [];

  for (const session of sortedSessions) {
    const branch = sessionBranchMap.get(session.name);
    if (branch && reviewBranches.has(branch)) continue;
    const pr = sessionPrMap.get(session.name);
    const isMerged = branch ? mergedBranches.has(branch) : false;
    const conflictCount = branch ? conflictCounts.get(branch) : undefined;
    const item: SidebarItem = {
      kind: 'session',
      session,
      pr,
      branch,
      isMerged,
      conflictCount,
    };
    if (!pr) noPrSessions.push(item);
    else if (pr.isDraft) draftPrSessions.push(item);
    else activePrSessions.push(item);
  }

  // 1. Worktrees (sessions with no PR)
  items.push(...noPrSessions);

  // 2. Draft Pull Requests — session-backed first, then orphans
  items.push(...draftPrSessions);
  for (const pr of orphanPrs.filter((p) => p.isDraft === true)) {
    items.push({ kind: 'orphan-pr', pr });
  }

  // 3. Pull Requests — session-backed first, then orphans
  items.push(...activePrSessions);
  for (const pr of orphanPrs.filter((p) => p.isDraft !== true)) {
    items.push({ kind: 'orphan-pr', pr });
  }

  // Helper: determine running status for a review PR based on session state
  const reviewRunning = (pr: PullRequestInfo): boolean | undefined => {
    const session = sessionByName.get(branchToSessionName(pr.sourceBranch));
    return session?.running;
  };

  // 4-6. Review PRs by category
  for (const pr of categorizedReviews.needsReview) {
    items.push({ kind: 'review-pr', pr, category: 'needs-review', running: reviewRunning(pr) });
  }
  for (const pr of categorizedReviews.waitingForAuthor) {
    items.push({ kind: 'review-pr', pr, category: 'waiting', running: reviewRunning(pr) });
  }
  for (const pr of categorizedReviews.approvedByYou) {
    items.push({ kind: 'review-pr', pr, category: 'approved', running: reviewRunning(pr) });
  }

  return items;
}
