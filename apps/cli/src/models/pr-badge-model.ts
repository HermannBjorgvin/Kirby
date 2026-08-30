import {
  isBlockingDecision,
  type BuildStatusState,
  type PullRequestInfo,
} from '@kirby/vcs-core';

/**
 * Everything the sidebar's PR badge decides before it draws anything.
 *
 * The badge crams four independent facts — the request's identity,
 * how many reviewers have signed off, how many comments are still
 * open, and what CI did — into one terminal row, and each of them has
 * its own rule about when it appears and in what colour. Left in the
 * JSX those rules read as noise between the markup; pulled out here
 * the grid is small enough to state, and to test.
 *
 * This is deliberately *not* shared with the desktop's
 * `prStatusIndicator`. The two answer different questions: the desktop
 * collapses both axes into a single circle whose colour CI can
 * escalate, while the TUI keeps review colour and build glyph in
 * separate cells and adds an attention signal (🔔/⭐) that the desktop
 * has no equivalent of. Merging them would mean picking one product's
 * rules for both.
 */
export interface PrBadgeModel {
  /** `#123`, wrapped in an OSC-8 hyperlink when the PR has a URL. */
  idText: string;
  /** `n/m approved`, or '' when nobody has been asked to review. */
  reviewText: string;
  reviewColor: string;
  /** `N comment(s)`, or '' when none are open. */
  commentText: string;
  /**
   * The right-aligned cluster (build glyph and/or attention glyph),
   * already joined. Empty when there is nothing to align right, which
   * is also the signal not to render the trailing box at all.
   */
  trailing: string;
  /** Sidebar width minus its border, floored so the badge never
   *  collapses to nothing on a very narrow pane. */
  innerWidth: number;
}

/**
 * Review colour is worst-first: one rejection paints the badge red
 * however many approvals sit next to it, and any other blocking vote
 * is yellow. Green needs a unanimous set, so a PR nobody has been
 * asked to review stays gray rather than looking finished.
 */
export function reviewColor(reviewers: PullRequestInfo['reviewers']): string {
  const list = reviewers ?? [];
  if (list.some((r) => r.decision === 'rejected')) return 'red';
  if (list.some((r) => isBlockingDecision(r.decision))) return 'yellow';
  if (list.length > 0 && list.every((r) => r.decision === 'approved')) {
    return 'green';
  }
  return 'gray';
}

const BUILD_EMOJI: Record<BuildStatusState, string> = {
  failed: '🔥',
  succeeded: '✅',
  pending: '⏳',
  none: '',
};

/** CI glyph for the build state; '' when there is no build to show. */
export function buildEmoji(status: BuildStatusState | undefined): string {
  return status ? BUILD_EMOJI[status] : '';
}

/**
 * The attention glyph. A fully approved request with nothing
 * outstanding gets a star; anything actually waiting on the author
 * gets a bell — except on a draft, where the author already knows the
 * work is unfinished and a bell would fire on every PR they open.
 */
export function statusEmoji({
  color,
  needsAttention,
  isDraft,
}: {
  color: string;
  needsAttention: boolean;
  isDraft: boolean;
}): string {
  if (color === 'green' && !needsAttention) return '⭐';
  if (needsAttention && !isDraft) return '🔔';
  return '';
}

/** OSC-8 hyperlink so terminals that support it make `#123` clickable. */
function idText(pr: PullRequestInfo): string {
  return pr.url ? `\x1b]8;;${pr.url}\x07#${pr.id}\x1b]8;;\x07` : `#${pr.id}`;
}

function commentText(count: number): string {
  if (count <= 0) return '';
  return `${count} comment${count !== 1 ? 's' : ''}`;
}

/**
 * The build glyph carries a wrench so it reads as "build" rather than
 * as a second verdict, and the two glyphs are spaced only when both
 * are present.
 */
function trailingText(build: string, status: string): string {
  const buildPart = build ? `🔧${build}` : '';
  const gap = build && status ? ' ' : '';
  return `${buildPart}${gap}${status}`;
}

export function prBadgeModel(
  pr: PullRequestInfo,
  sidebarWidth: number
): PrBadgeModel {
  const reviewers = pr.reviewers ?? [];
  const approved = reviewers.filter((r) => r.decision === 'approved').length;
  const color = reviewColor(reviewers);
  const activeComments = pr.activeCommentCount ?? 0;
  const build = buildEmoji(pr.buildStatus);
  const status = statusEmoji({
    color,
    // A blocking vote and an open comment are the same kind of
    // outstanding thing here: someone is waiting on the author.
    needsAttention:
      activeComments > 0 ||
      reviewers.some((r) => isBlockingDecision(r.decision)),
    isDraft: pr.isDraft === true,
  });

  return {
    idText: idText(pr),
    reviewText:
      reviewers.length > 0 ? `${approved}/${reviewers.length} approved` : '',
    reviewColor: color,
    commentText: commentText(activeComments),
    trailing: trailingText(build, status),
    innerWidth: Math.max(10, sidebarWidth - 2),
  };
}
