import type { ReviewDecision } from '@kirby/vcs-core/types';
import type { SidebarItem } from '../../host/contract.js';

export type SectionKey =
  | 'worktrees'
  | 'draft-pull-requests'
  | 'pull-requests'
  | 'needs-review'
  | 'waiting'
  | 'approved';

export const SECTION_ORDER: SectionKey[] = [
  'worktrees',
  'draft-pull-requests',
  'pull-requests',
  'needs-review',
  'waiting',
  'approved',
];

export const SECTION_LABEL: Record<SectionKey, string> = {
  worktrees: 'Worktrees',
  'draft-pull-requests': 'Draft Pull Requests',
  'pull-requests': 'Pull Requests',
  'needs-review': 'Needs Your Review',
  waiting: 'Waiting for Author',
  approved: 'Approved by You',
};

/**
 * Stable identity for an editor tab / selection. A single PR keeps the
 * same key as it moves between sidebar kinds — launching an agent turns
 * an orphan/review PR into a session-backed row, and it must not orphan
 * the open tab — so any PR-bearing item is keyed by its PR id, and a
 * plain worktree by its branch.
 */
export function itemKey(item: SidebarItem): string {
  const pr = item.pr;
  if (pr) return `pr:${pr.id}`;
  if (item.kind === 'session')
    return `branch:${item.branch ?? item.session.name}`;
  return `pr:${item.pr.id}`;
}

export function sectionKey(item: SidebarItem): SectionKey {
  if (item.kind === 'session') {
    if (!item.pr) return 'worktrees';
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.kind === 'orphan-pr') {
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.category === 'needs-review') return 'needs-review';
  if (item.category === 'waiting') return 'waiting';
  return 'approved';
}

export function itemRunning(item: SidebarItem): boolean {
  if (item.kind === 'session') return item.session.running;
  return item.running === true;
}

/** Display title for an item (branch for sessions, PR title otherwise). */
export function itemTitle(item: SidebarItem): string {
  if (item.kind === 'session') {
    return item.branch ?? item.session.name;
  }
  return item.pr.title;
}

/** The git branch an item corresponds to. */
export function itemBranch(item: SidebarItem): string {
  if (item.kind === 'session') return item.branch ?? item.session.name;
  return item.pr.sourceBranch;
}

/** PTY session name for an item — the worktree session, or (for PR
 *  items) the alive review session the host attached to it. */
export function itemSessionName(item: SidebarItem): string | undefined {
  if (item.kind === 'session') return item.session.name;
  return item.sessionName;
}

export function itemHasWorktree(item: SidebarItem): boolean {
  if (item.kind === 'session') return true;
  return Boolean(item.sessionName);
}

/**
 * Reflect worktree removals that have been confirmed but not yet
 * finished, so the whole window reacts when the user clicks Remove
 * rather than when git and the session teardown are done.
 *
 * The two row kinds want opposite treatment, which is the part that is
 * easy to get wrong: a plain worktree row *is* the worktree and goes,
 * but a PR row outlives its checkout — the pull request is still open
 * and still belongs in its review section. Dropping it would blank a
 * row the refetch then puts straight back. So the PR row stays and only
 * the parts that describe a worktree are cleared, which is also what
 * takes "Stop agent" and "Remove worktree…" out of its context menu and
 * stops its running indicator.
 *
 * Nothing here needs rolling back: a failed removal stops being
 * pending, and the rows return exactly as they were.
 */
export function applyPendingRemovals(
  items: SidebarItem[],
  removing: ReadonlySet<string>
): SidebarItem[] {
  if (removing.size === 0) return items;
  return items.flatMap((item) => {
    if (!removing.has(itemBranch(item))) return [item];
    if (item.kind === 'session') return [];
    return [{ ...item, sessionName: undefined, running: undefined }];
  });
}

export interface SidebarSection {
  key: SectionKey;
  label: string;
  items: SidebarItem[];
}

/** Group the ordered flat list into its sections (TUI order preserved). */
export function groupSections(items: SidebarItem[]): SidebarSection[] {
  const map = new Map<SectionKey, SidebarItem[]>();
  for (const item of items) {
    const k = sectionKey(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return SECTION_ORDER.filter((k) => map.has(k)).map((k) => ({
    key: k,
    label: SECTION_LABEL[k],
    items: map.get(k) ?? [],
  }));
}

// ── Pull request status cluster ──────────────────────────────────

/**
 * A pull request row shows one indicator carrying two independent
 * facts, so the two have to stay separable at a glance:
 *
 *   colour  — where the pull request stands with people
 *   glyph   — where it stands with CI
 *   filled  — nothing left to wait for on either axis
 *
 * Collapsing them into a single "good/bad" reading is what made a
 * request that was only waiting on a reviewer look identical to one
 * whose build never reported.
 */
export type ApprovalState = 'rejected' | 'blocked' | 'approved' | 'partial';
export type CiGlyph = 'passed' | 'failed' | 'running' | 'absent';

export interface PrStatusIndicator {
  approval: ApprovalState;
  /** What CI has to say. `absent` covers both "never ran" and
   *  "withdrew" — Azure checks that end `notApplicable` land here. */
  ci: CiGlyph;
  label: string;
  filled: boolean;
  approved: number;
  total: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function ciPhrase(ci: CiGlyph): string {
  if (ci === 'passed') return 'CI passed';
  if (ci === 'failed') return 'CI failed';
  if (ci === 'running') return 'CI running';
  return 'No CI result';
}

function approvalPhrase(
  approval: ApprovalState,
  approved: number,
  total: number
): string {
  const of = `${approved} of ${plural(total, 'reviewer')} approved`;
  if (approval === 'rejected') return `changes rejected (${of})`;
  if (approval === 'blocked') return `waiting for the author (${of})`;
  if (approval === 'approved')
    return `all ${plural(total, 'reviewer')} approved`;
  if (total === 0) return 'no reviewers yet';
  return `waiting on ${plural(total - approved, 'approval')} (${of})`;
}

function ciGlyph(buildStatus: string | undefined): CiGlyph {
  if (buildStatus === 'succeeded') return 'passed';
  if (buildStatus === 'failed') return 'failed';
  if (buildStatus === 'pending') return 'running';
  return 'absent';
}

/**
 * Both axes of a pull request's state, and the sentence describing them.
 *
 * The only cell that gets its own wording is the one a reader acts on:
 * approvals in and CI green means the request can be merged, and saying
 * so is more use than making them read two clauses and conclude it.
 */
export function prStatusIndicator(
  reviewers: { decision: ReviewDecision }[],
  buildStatus: string | undefined,
  isBlocking: (decision: ReviewDecision) => boolean
): PrStatusIndicator {
  const total = reviewers.length;
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  const ci = ciGlyph(buildStatus);

  const approval: ApprovalState = reviewers.some(
    (r) => r.decision === 'rejected'
  )
    ? 'rejected'
    : reviewers.some((r) => isBlocking(r.decision))
    ? 'blocked'
    : total > 0 && approved === total
    ? 'approved'
    : 'partial';

  const ready = approval === 'approved' && ci === 'passed';
  const label = ready
    ? `Ready to merge — CI passed, all ${plural(total, 'reviewer')} approved`
    : `${ciPhrase(ci)} — ${approvalPhrase(approval, approved, total)}`;

  return { approval, ci, label, filled: ready, approved, total };
}

/** Tooltip for the comment count. */
export function unresolvedCommentsLabel(count: number): string {
  return `${plural(count, 'unresolved comment')}`;
}
