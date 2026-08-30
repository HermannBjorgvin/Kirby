import type { PullRequestInfo, CategorizedReviews } from '@kirby/vcs-core';
import type { AgentSession, ReviewCategory, SidebarItem } from '../types.js';
import { branchToSessionName } from '@kirby/worktree-manager';

/** The branches every review section covers, in one set. */
function collectReviewBranches(reviews: CategorizedReviews): Set<string> {
  return new Set(
    [
      ...reviews.needsReview,
      ...reviews.waitingForAuthor,
      ...reviews.approvedByYou,
    ].map((pr) => pr.sourceBranch)
  );
}

/** The three session sections, in the order they are emitted. */
interface SessionBuckets {
  noPr: SidebarItem[];
  draftPr: SidebarItem[];
  activePr: SidebarItem[];
}

/**
 * Split the worktree sessions across the sections they belong to.
 *
 * A session whose branch is under review is dropped here rather than
 * emitted: it appears in its review section instead, carrying the running
 * LED, and listing it twice would give the same worktree two rows.
 */
function bucketSessions(
  sortedSessions: AgentSession[],
  reviewBranches: Set<string>,
  sessionBranchMap: Map<string, string>,
  sessionPrMap: Map<string, PullRequestInfo>,
  mergedBranches: Set<string>,
  conflictCounts: Map<string, number>
): SessionBuckets {
  const buckets: SessionBuckets = { noPr: [], draftPr: [], activePr: [] };

  for (const session of sortedSessions) {
    const branch = sessionBranchMap.get(session.name);
    if (branch && reviewBranches.has(branch)) continue;

    const pr = sessionPrMap.get(session.name);
    const item: SidebarItem = {
      kind: 'session',
      session,
      pr,
      branch,
      isMerged: branch ? mergedBranches.has(branch) : false,
      conflictCount: branch ? conflictCounts.get(branch) : undefined,
    };

    if (!pr) buckets.noPr.push(item);
    else if (pr.isDraft) buckets.draftPr.push(item);
    else buckets.activePr.push(item);
  }

  return buckets;
}

/**
 * Build a flat, ordered list of sidebar items from all data sources.
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
  const sessions = bucketSessions(
    sortedSessions,
    collectReviewBranches(categorizedReviews),
    sessionBranchMap,
    sessionPrMap,
    mergedBranches,
    conflictCounts
  );

  const sessionByName = new Map(sortedSessions.map((s) => [s.name, s]));

  /** The alive worktree session backing a PR's branch, if any. */
  const prSession = (pr: PullRequestInfo): AgentSession | undefined =>
    sessionByName.get(branchToSessionName(pr.sourceBranch));

  const orphanItem = (pr: PullRequestInfo): SidebarItem => {
    const session = prSession(pr);
    return {
      kind: 'orphan-pr',
      pr,
      running: session?.running,
      sessionName: session?.name,
    };
  };

  const reviewItem =
    (category: ReviewCategory) =>
    (pr: PullRequestInfo): SidebarItem => {
      const session = prSession(pr);
      return {
        kind: 'review-pr',
        pr,
        category,
        running: session?.running,
        sessionName: session?.name,
      };
    };

  // The section order the sidebar reads top to bottom. Within the two PR
  // sections, a request that has a worktree checked out sorts above one
  // that does not.
  return [
    // 1. Worktrees — sessions with no PR
    ...sessions.noPr,

    // 2. Draft pull requests
    ...sessions.draftPr,
    ...orphanPrs.filter((p) => p.isDraft === true).map(orphanItem),

    // 3. Pull requests
    ...sessions.activePr,
    ...orphanPrs.filter((p) => p.isDraft !== true).map(orphanItem),

    // 4. Needs review (others' PRs you need to review)
    ...categorizedReviews.needsReview.map(reviewItem('needs-review')),
    // 5. Waiting for author
    ...categorizedReviews.waitingForAuthor.map(reviewItem('waiting')),
    // 6. Approved by you
    ...categorizedReviews.approvedByYou.map(reviewItem('approved')),
  ];
}
