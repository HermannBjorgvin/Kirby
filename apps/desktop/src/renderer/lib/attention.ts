// NOTE: the renderer must import vcs-core through the pure `/types`
// subpath — the package root re-exports the config store, whose
// `node:fs` import blanks the whole window in the browser bundle.
import {
  isBlockingDecision,
  type PullRequestInfo,
} from '@kirby/vcs-core/types';
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

/**
 * File a PR under one category. A PR already open in a tab is counted
 * rather than listed — the rail is for what you have not looked at.
 */
function addEntry(
  cat: AttentionCategory,
  pr: PullRequestInfo,
  key: string,
  open: boolean
): void {
  if (open) cat.openInTabs += 1;
  else cat.entries.push({ pr, key });
}

/**
 * The three things that can want your attention on a PR of your own.
 * They are not exclusive: a request can be failing CI, rejected and
 * carrying open comments all at once, and appears under each.
 */
function classifyOwnPr(
  model: AttentionModel,
  pr: PullRequestInfo,
  key: string,
  open: boolean
): void {
  if (pr.buildStatus === 'failed') addEntry(model.ciFailing, pr, key, open);
  if (pr.reviewers?.some((r) => isBlockingDecision(r.decision))) {
    addEntry(model.changesRequested, pr, key, open);
  }
  if ((pr.activeCommentCount ?? 0) > 0) {
    addEntry(model.unresolvedComments, pr, key, open);
    if (!open) model.unresolvedCommentTotal += pr.activeCommentCount ?? 0;
  }
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
      addEntry(model.needsReview, pr, key, open);
    }
    if (isOwnPr(item)) classifyOwnPr(model, pr, key, open);
  }
  return model;
}
