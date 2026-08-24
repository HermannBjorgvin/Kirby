import type { PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem } from '../../host/contract.js';
import { itemKey } from './sidebar-model.js';

/**
 * The collapsed-sidebar attention model: what needs the developer that
 * they are NOT already looking at. PRs whose tab is open are excluded
 * from the actionable list (the tab itself carries their state) but
 * still tallied so the UI can say "+N already open".
 */

export interface AttentionEntry {
  pr: PullRequestInfo;
  /** Renderer item key — opens the PR's tab. */
  key: string;
}

export interface AttentionCategory {
  /** Entries not currently open as a tab (the actionable ones). */
  entries: AttentionEntry[];
  /** How many matching PRs were skipped because their tab is open. */
  openInTabs: number;
}

export interface AttentionModel {
  needsReview: AttentionCategory;
  ciFailing: AttentionCategory;
  changesRequested: AttentionCategory;
  unresolvedComments: AttentionCategory;
  /** Total unresolved comment count across not-open PRs. */
  unresolvedCommentTotal: number;
}

function emptyCategory(): AttentionCategory {
  return { entries: [], openInTabs: 0 };
}

/** Is this item one of *your* PRs (worktree-backed or orphan)? */
function isOwnPr(item: SidebarItem): boolean {
  return (
    (item.kind === 'session' || item.kind === 'orphan-pr') && item.pr != null
  );
}

export function buildAttentionModel(
  items: readonly SidebarItem[],
  openTabKeys: ReadonlySet<string>
): AttentionModel {
  const model: AttentionModel = {
    needsReview: emptyCategory(),
    ciFailing: emptyCategory(),
    changesRequested: emptyCategory(),
    unresolvedComments: emptyCategory(),
    unresolvedCommentTotal: 0,
  };

  const add = (
    cat: AttentionCategory,
    pr: PullRequestInfo,
    key: string,
    open: boolean
  ) => {
    if (open) cat.openInTabs += 1;
    else cat.entries.push({ pr, key });
  };

  const seen = new Set<string>();
  for (const item of items) {
    const pr = item.pr;
    if (!pr) continue;
    const key = itemKey(item);
    // A PR can appear as both a session row and a review row; count once.
    if (seen.has(key)) continue;
    seen.add(key);
    const open = openTabKeys.has(key);

    if (item.kind === 'review-pr' && item.category === 'needs-review') {
      add(model.needsReview, pr, key, open);
    }
    if (isOwnPr(item)) {
      if (pr.buildStatus === 'failed') add(model.ciFailing, pr, key, open);
      if (pr.reviewers?.some((r) => r.decision === 'changes-requested')) {
        add(model.changesRequested, pr, key, open);
      }
      if ((pr.activeCommentCount ?? 0) > 0) {
        add(model.unresolvedComments, pr, key, open);
        if (!open) model.unresolvedCommentTotal += pr.activeCommentCount ?? 0;
      }
    }
  }
  return model;
}
