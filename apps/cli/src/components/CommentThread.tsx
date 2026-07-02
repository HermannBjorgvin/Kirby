import { memo } from 'react';
import { Box, Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  estimateBodyRows,
  estimateCardRows,
  estimateReplyInputRows,
  type ReviewComment,
} from '@kirby/review-comments';
import { planItemKey } from '../plan/plan-types.js';

// Shared Ink-based renderings for remote threads AND local drafts.
//
// Consumers:
//   - GeneralCommentsPane (Shift+C)       → <CommentThreadCard>
//   - DiffFileList PR-comments footer     → <CommentThreadCard>
//   - DiffViewer inline (M2 unification)  → <CommentThreadCard> for
//     remote threads, <LocalCommentCard> for local drafts.
//
// Single component per kind everywhere — no more ANSI/Ink split.

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

// ── Full-size card ───────────────────────────────────────────────────

interface CommentThreadCardProps {
  thread: RemoteCommentThread;
  /** Highlight the border + show action hints when true */
  selected?: boolean;
  /** Reply-input overlay for the Shift+C pane */
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  /**
   * Cap the card's visible width. When set, the card renders inside a
   * fixed-width Box so it doesn't stretch to the full pane width —
   * matches the ANSI predecessor that capped at ~80 cols so threads sit
   * next to the diff code rather than dominating the viewport.
   * Undefined = flex (pane fills the card, used by GeneralCommentsPane).
   */
  maxWidth?: number;
  /**
   * Left indent (in cells). Matches the diff renderer's gutter so the
   * card starts where the code content does. Default 0.
   */
  indent?: number;
  /** Whether the comment is queued in the PR plan (drives the hint). */
  inPlan?: boolean;
  /**
   * Show the a/A plan-action hint when selected. Only consumers whose
   * input context actually handles the plan actions (diff viewer,
   * diff-file-list footer) should set this — the Shift+C pane must not.
   */
  planHint?: boolean;
}

/** Hint text for the a/A plan actions; adapts to plan membership. */
function planHintText(inPlan: boolean): string {
  return inPlan ? ' [a] remove [A] annotate' : ' [a/A]dd to draft plan';
}

// Constants that mirror the previous ANSI renderer's visual language —
// kept so card width + indent line up with diff row content.
export const CARD_MAX_WIDTH = 80;
export const CARD_INDENT = 13;

export const CommentThreadCard = memo(function CommentThreadCard({
  thread,
  selected = false,
  replyingToThreadId,
  replyBuffer,
  maxWidth,
  indent,
  inPlan = false,
  planHint = false,
}: CommentThreadCardProps) {
  const rootComment = thread.comments[0];
  if (!rootComment) return null;

  const isReplying = replyingToThreadId === thread.id;

  const card = (
    <Box
      flexDirection="column"
      // Always frame the card — a gray border when unselected keeps the
      // shape consistent across the Shift+C pane (where one card is
      // always selected) and the file-list footer (where none is). The
      // selected variant swaps in cyan for visual emphasis; in-plan
      // cards tint green (matches the corner PlanIndicator) so plan
      // membership stays visible without a badge.
      borderStyle="round"
      borderColor={selected ? 'cyan' : inPlan ? 'green' : 'gray'}
      marginBottom={1}
      paddingX={1}
      {...(maxWidth !== undefined ? { width: maxWidth } : {})}
    >
      {/*
        Header is one logical line — collapse into a single <Text> with
        nested color spans so Ink's text-measure pipeline keeps every
        span on one row and truncates on overflow. Sibling <Text> nodes
        in a row Box would each get a flex-shrunk column allocation and
        wrap individually, producing a 2-row mangled header
        ("kirby-test-run | er", " · 2h | ago", "[r]eply | [v]reopen").
      */}
      <Text wrap="truncate-end">
        <Text bold color={selected ? 'cyan' : 'blue'}>
          {rootComment.author}
        </Text>
        <Text dimColor>{` · ${relativeTime(rootComment.createdAt)}`}</Text>
        {thread.isResolved && <Text color="green">{' ✓ resolved'}</Text>}
        {thread.isOutdated && <Text dimColor>{' (outdated)'}</Text>}
        {selected && !isReplying && (
          <Text dimColor>
            {'  [r]eply'}
            {thread.canResolve
              ? ` [v]${thread.isResolved ? 'reopen' : 'resolve'}`
              : ''}
            {planHint ? planHintText(inPlan) : ''}
          </Text>
        )}
        {isReplying && (
          <>
            <Text color="cyan">{'  REPLY'}</Text>
            <Text dimColor>{' [enter] send · [esc] cancel'}</Text>
          </>
        )}
      </Text>
      <Text wrap="wrap">{rootComment.body}</Text>
      {thread.comments.length > 1 && (
        <Box flexDirection="column" marginTop={1}>
          {thread.comments.slice(1).map((reply) => (
            <Box key={reply.id} flexDirection="column" marginLeft={2}>
              <Text wrap="truncate-end">
                <Text bold color="blue">
                  {reply.author}
                </Text>
                <Text dimColor>{` · ${relativeTime(reply.createdAt)}`}</Text>
              </Text>
              <Text wrap="wrap">{reply.body}</Text>
            </Box>
          ))}
        </Box>
      )}
      {isReplying && (
        <Box
          flexDirection="column"
          marginTop={1}
          marginLeft={2}
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text>{replyBuffer ?? ''}▍</Text>
        </Box>
      )}
    </Box>
  );

  // Indent the card so it lines up with the diff gutter when requested.
  // Rendered as a sibling <Box> that consumes `indent` columns; keeps
  // the card's own padding/border math simple.
  if (indent && indent > 0) {
    return (
      <Box>
        <Box width={indent} flexShrink={0} />
        {card}
      </Box>
    );
  }
  return card;
});

// ── Local comment card (draft / unposted) ───────────────────────────

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

interface LocalCommentCardProps {
  comment: ReviewComment;
  /** Highlight + expand body when selected. */
  selected?: boolean;
  /** When true, show the delete-confirm prompt header. */
  pendingDelete?: boolean;
  /** When true, render `editBuffer` as the body with a cursor. */
  editing?: boolean;
  editBuffer?: string;
  /** See CommentThreadCard.maxWidth. */
  maxWidth?: number;
  /** See CommentThreadCard.indent. */
  indent?: number;
  /** Whether the comment is queued in the PR plan (drives the hint). */
  inPlan?: boolean;
  /** See CommentThreadCard.planHint. */
  planHint?: boolean;
}

export const LocalCommentCard = memo(function LocalCommentCard({
  comment,
  selected = false,
  pendingDelete = false,
  editing = false,
  editBuffer,
  maxWidth,
  indent,
  inPlan = false,
  planHint = false,
}: LocalCommentCardProps) {
  const severityColor = SEVERITY_COLOR[comment.severity] ?? 'gray';
  const statusMark = STATUS_MARK[comment.status];
  const bodyLines = comment.body.split('\n');
  const MAX_COLLAPSED = 4;
  const shownLines =
    selected || editing ? bodyLines : bodyLines.slice(0, MAX_COLLAPSED);
  const truncated = !selected && !editing && bodyLines.length > MAX_COLLAPSED;

  const card = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={selected ? 'yellow' : inPlan ? 'green' : 'gray'}
      marginBottom={1}
      paddingX={1}
      {...(maxWidth !== undefined ? { width: maxWidth } : {})}
    >
      {/* See note in <CommentThreadCard> — single <Text> keeps the
          header on one row and truncates on overflow rather than
          flex-shrinking each span into a wrapping column. */}
      <Text wrap="truncate-end">
        <Text bold color={severityColor}>
          [{comment.severity}]
        </Text>
        {statusMark && (
          <Text color={statusMark.color}>{` ${statusMark.char}`}</Text>
        )}
        {pendingDelete && <Text color="red">{'  Delete? [y]es [n]o'}</Text>}
        {selected && !editing && !pendingDelete && (
          <Text dimColor>
            {'  [e]dit [x]delete [p]ost'}
            {planHint ? planHintText(inPlan) : ''}
          </Text>
        )}
        {editing && (
          <>
            <Text color="cyan">{'  EDITING'}</Text>
            <Text dimColor>{' [esc] save · [ctrl+c] cancel'}</Text>
          </>
        )}
      </Text>
      {editing ? (
        <Text>
          {editBuffer ?? ''}
          <Text color="cyan">▍</Text>
        </Text>
      ) : (
        <>
          {shownLines.map((line, i) => (
            <Text key={i} wrap="wrap">
              {line || ' '}
            </Text>
          ))}
          {truncated && (
            <Text dimColor>
              … {bodyLines.length - MAX_COLLAPSED} more lines
            </Text>
          )}
        </>
      )}
    </Box>
  );

  if (indent && indent > 0) {
    return (
      <Box>
        <Box width={indent} flexShrink={0} />
        {card}
      </Box>
    );
  }
  return card;
});

/**
 * Shared layout decision for the diff-file-list PR-comments footer.
 * Returns every thread (all stay j/k-selectable — the footer scrolls
 * cards into view rather than capping the list) plus per-card row
 * estimates so DiffFileList can budget its footer window.
 *
 * `contentWidth` is the card's interior text width (card width minus
 * border + padding). Without it, estimates cap bodies at 4 lines and
 * wrapped long bodies are badly undercounted — always pass it from
 * render paths.
 */
/** Live compose state that changes a card's rendered height. */
export interface FooterComposeState {
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
}

export function planCommentFooter(
  threads: RemoteCommentThread[],
  contentWidth?: number,
  compose?: FooterComposeState
): {
  shown: RemoteCommentThread[];
  rows: number;
  spans: number[];
} {
  if (threads.length === 0) return { shown: [], rows: 0, spans: [] };
  const spans = threads.map((thread) => {
    // The Shift+A note composer REPLACES the card in the file-list
    // render, so its span replaces the card estimate too: border (2)
    // + header row + wrapped buffer (with cursor cell) + marginBottom.
    if (compose?.annotatingPlanKey === planItemKey('remote', thread.id)) {
      return (
        2 +
        1 +
        estimateBodyRows(`${compose.annotationBuffer ?? ''}▍`, contentWidth) +
        1
      );
    }
    return (
      estimateCardRows(thread, contentWidth) +
      (thread.id === compose?.replyingToThreadId
        ? estimateReplyInputRows(compose.replyBuffer ?? '', contentWidth)
        : 0)
    );
  });
  // +1 for the "PR Comments (N)" heading
  const rows = 1 + spans.reduce((sum, s) => sum + s, 0);
  return { shown: threads, rows, spans };
}
