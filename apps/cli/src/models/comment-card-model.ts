import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  AGENT_ATTRIBUTION,
  commentBodyParts,
  conventionalSeverity,
  type ReviewComment,
} from '@kirby/review-comments';

/**
 * The decisions a comment card makes before it draws anything.
 *
 * Both cards render their header as one logical line — see the note in
 * CommentThread.tsx for why it has to be a single <Text> — which means
 * the header is really a sequence of coloured runs, not a layout. That
 * makes it data: this module decides which runs exist and how each is
 * coloured, and the component walks the list. What the terminal
 * actually shows is text and colour, so every rule that picks either
 * one lives here where it can be enumerated in a test.
 */

export function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** One coloured run of the single-line card header. */
export interface HeaderSpan {
  /** Stable across renders — identifies the run, not its position. */
  key: string;
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
}

/** Hint text for the a/A plan actions; adapts to plan membership. */
export function planHintText(inPlan: boolean): string {
  return inPlan ? ' [a] remove [A] annotate' : ' [a/A]dd to draft plan';
}

/**
 * Border colour. Selection outranks plan membership: a card is only
 * ever selected one at a time, so that tint has to stay legible, while
 * the green plan tint is a background fact about the card that the
 * selected card can afford to drop.
 */
export function cardBorderColor({
  selected,
  inPlan,
  selectedColor,
}: {
  selected: boolean;
  inPlan: boolean;
  selectedColor: string;
}): string {
  if (selected) return selectedColor;
  return inPlan ? 'green' : 'gray';
}

// ── Remote thread header ────────────────────────────────────────────

export interface ThreadHeaderState {
  selected: boolean;
  /** The reply composer is open on this thread. */
  replying: boolean;
  /** Consumer handles the a/A plan actions and wants their hint. */
  planHint: boolean;
  inPlan: boolean;
}

/**
 * Action hints for a selected thread. `[v]` is suppressed entirely on
 * threads the provider will not let us resolve (issue comments), since
 * offering a key that does nothing is worse than offering none.
 */
export function threadHintText(
  thread: Pick<RemoteCommentThread, 'canResolve' | 'isResolved'>,
  { planHint, inPlan }: { planHint: boolean; inPlan: boolean }
): string {
  const resolve = thread.canResolve
    ? ` [v]${thread.isResolved ? 'reopen' : 'resolve'}`
    : '';
  return `  [r]eply${resolve}${planHint ? planHintText(inPlan) : ''}`;
}

export function threadHeaderSpans(
  thread: RemoteCommentThread,
  state: ThreadHeaderState
): HeaderSpan[] {
  const root = thread.comments[0];
  if (!root) return [];

  const spans: HeaderSpan[] = [
    {
      key: 'author',
      text: root.author,
      bold: true,
      color: state.selected ? 'cyan' : 'blue',
    },
    { key: 'time', text: ` · ${relativeTime(root.createdAt)}`, dim: true },
  ];
  if (thread.isResolved) {
    spans.push({ key: 'resolved', text: ' ✓ resolved', color: 'green' });
  }
  if (thread.isOutdated) {
    spans.push({ key: 'outdated', text: ' (outdated)', dim: true });
  }
  // Hints and the reply banner are mutually exclusive: while the
  // composer is open the only keys that do anything are its own.
  if (state.selected && !state.replying) {
    spans.push({
      key: 'hints',
      text: threadHintText(thread, state),
      dim: true,
    });
  }
  if (state.replying) {
    spans.push(
      { key: 'mode', text: '  REPLY', color: 'cyan' },
      { key: 'mode-hint', text: ' [enter] send · [esc] cancel', dim: true }
    );
  }
  return spans;
}

/** Author + timestamp line for a reply nested under the root comment. */
export function replyHeaderSpans(reply: {
  author: string;
  createdAt: string;
}): HeaderSpan[] {
  return [
    { key: 'author', text: reply.author, bold: true, color: 'blue' },
    { key: 'time', text: ` · ${relativeTime(reply.createdAt)}`, dim: true },
  ];
}

// ── Local draft header ──────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'red',
  major: 'yellow',
  minor: 'cyan',
  nit: 'gray',
};

const STATUS_MARK: Record<string, { char: string; color: string }> = {
  posting: { char: '⏳', color: 'yellow' },
  posted: { char: '✓', color: 'green' },
};

export function severityColor(severity: string): string {
  return SEVERITY_COLOR[severity] ?? 'gray';
}

export interface LocalHeaderState {
  selected: boolean;
  /** The delete-confirm prompt has taken over the header. */
  pendingDelete: boolean;
  /** The body has been replaced by the edit buffer. */
  editing: boolean;
  planHint: boolean;
  inPlan: boolean;
}

export function localHeaderSpans(
  comment: Pick<ReviewComment, 'severity' | 'status'>,
  state: LocalHeaderState
): HeaderSpan[] {
  const spans: HeaderSpan[] = [
    {
      key: 'severity',
      text: `[${comment.severity}]`,
      bold: true,
      color: severityColor(comment.severity),
    },
  ];
  const mark = STATUS_MARK[comment.status];
  if (mark) {
    spans.push({ key: 'status', text: ` ${mark.char}`, color: mark.color });
  }
  if (state.pendingDelete) {
    spans.push({ key: 'delete', text: '  Delete? [y]es [n]o', color: 'red' });
  }
  // Both modal states own the header while they are open, so the
  // idle hints only appear when neither is.
  if (state.selected && !state.editing && !state.pendingDelete) {
    spans.push({
      key: 'hints',
      text: `  [e]dit [x]delete [p]ost${
        state.planHint ? planHintText(state.inPlan) : ''
      }`,
      dim: true,
    });
  }
  if (state.editing) {
    spans.push(
      { key: 'mode', text: '  EDITING', color: 'cyan' },
      { key: 'mode-hint', text: ' [esc] save · [ctrl+c] cancel', dim: true }
    );
  }
  return spans;
}

// ── Comment bodies ──────────────────────────────────────────────────

/**
 * The signature line, as one row of dim text.
 *
 * The posted markdown is an italic line with a link in it; a terminal
 * has neither, so it is rendered from the attribution's parts instead
 * of by re-parsing what was posted. Both come from one constant, so
 * they cannot say different things.
 */
export const AGENT_FOOTER_LINE =
  `${AGENT_ATTRIBUTION.prefix}${AGENT_ATTRIBUTION.linkText}` +
  `${AGENT_ATTRIBUTION.suffix}`;

/** What a card paints for one comment body. */
export interface CommentBodyView {
  /** Label + decorations as coloured runs; empty when there is no
   *  header. Rendered as its own single row above the body. */
  badge: HeaderSpan[];
  /** The prose: subject and discussion, header and signature removed. */
  body: string;
  /** The signature row, or null. */
  footer: string | null;
}

/**
 * Split one comment body into what the card draws.
 *
 * A Conventional Comments header (conventionalcomments.org) is a
 * classification, so it becomes a coloured badge row and leaves the
 * prose — with the subject still the comment's first line. Bodies
 * without a header, which is most of a human's, come back verbatim.
 *
 * Every card measures itself by re-deriving what it will paint (see
 * `estimateCardRows` in @kirby/review-comments), so the estimator and
 * the component both go through here. A card measured against a
 * different split from the one it renders puts every row below it in
 * the wrong place.
 */
export function commentBodyView(body: string): CommentBodyView {
  const parts = commentBodyParts(body);
  if (!parts.header) {
    return {
      badge: [],
      body: parts.body,
      footer: parts.footer ? AGENT_FOOTER_LINE : null,
    };
  }
  const color = severityColor(conventionalSeverity(parts.header));
  const badge: HeaderSpan[] = [
    { key: 'label', text: parts.header.label, bold: true, color },
  ];
  if (parts.header.decorations.length > 0) {
    badge.push({
      key: 'decorations',
      text: ` (${parts.header.decorations.join(', ')})`,
      dim: true,
    });
  }
  return {
    badge,
    body: parts.body,
    footer: parts.footer ? AGENT_FOOTER_LINE : null,
  };
}

// ── Local draft body ────────────────────────────────────────────────

/**
 * An unselected draft shows at most this many body lines. The cap
 * exists so a long draft cannot push its neighbours off the pane while
 * the user is scanning past it — expanding is what selecting it does.
 * `estimateCollapsedBodyRows` in @kirby/review-comments mirrors this
 * number for the scroll maths; they have to move together.
 */
export const MAX_COLLAPSED_BODY_LINES = 4;

export interface CollapsedBody {
  lines: string[];
  /** Lines the cap is hiding; 0 when the whole body is shown. */
  hiddenCount: number;
}

export function collapseBody(body: string, expanded: boolean): CollapsedBody {
  const lines = commentBodyView(body).body.split('\n');
  if (expanded || lines.length <= MAX_COLLAPSED_BODY_LINES) {
    return { lines, hiddenCount: 0 };
  }
  return {
    lines: lines.slice(0, MAX_COLLAPSED_BODY_LINES),
    hiddenCount: lines.length - MAX_COLLAPSED_BODY_LINES,
  };
}
