import { memo } from 'react';
import { Box, Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { ReviewComment } from '@kirby/review-comments';

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
      // selected variant swaps in cyan for visual emphasis.
      borderStyle="round"
      borderColor={selected ? 'cyan' : 'gray'}
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
      {thread.comments.length > 1 && selected && (
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
      {thread.comments.length > 1 && !selected && (
        // Collapse replies when the card isn't selected — keeps the
        // viewport from being dominated by long threads. The user
        // selects the card (Shift+↓) to expand. Without this a single
        // thread with replies eats enough rows that the next card
        // gets row-budget-clipped off the bottom of the viewport.
        <Text dimColor>{`  +${thread.comments.length - 1} ${
          thread.comments.length - 1 === 1 ? 'reply' : 'replies'
        }`}</Text>
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
}

export const LocalCommentCard = memo(function LocalCommentCard({
  comment,
  selected = false,
  pendingDelete = false,
  editing = false,
  editBuffer,
  maxWidth,
  indent,
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
      borderColor={selected ? 'yellow' : 'gray'}
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
          <Text dimColor>{'  [e]dit [x]delete [p]ost'}</Text>
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

// ── Layout estimation ────────────────────────────────────────────────

/**
 * Estimate the row height of a <CommentThreadCard> so callers can reserve
 * space without measuring the rendered output. The numbers mirror the
 * card's structure: top border + author row + wrapped body (capped) +
 * per-reply block + marginBottom. It's conservative — real renders may
 * be shorter when the body is short, but we'd rather over-reserve than
 * have comment cards push file rows off-screen.
 */
export function estimateCardRows(
  thread: RemoteCommentThread,
  contentWidth?: number,
  selected = false
): number {
  const root = thread.comments[0];
  if (!root) return 0;
  // border-top + header + body + border-bottom + marginBottom = 2 + 1 + N + 1
  const rootRows = 4 + estimateBodyRows(root.body, contentWidth);
  // Replies are only rendered when the card is selected — see the
  // CommentThreadCard branch. Collapsed cards just show a one-line
  // "+N replies" hint, which is part of the rootRows body area
  // already (no extra rows reserved here).
  if (!selected) return rootRows;
  const replyRows = thread.comments.slice(1).reduce((sum, c) => {
    return sum + 1 + estimateBodyRows(c.body, contentWidth) + 1;
  }, 0);
  return rootRows + replyRows;
}

/**
 * Estimate how many rows a body string occupies after wrap. When
 * `contentWidth` is unknown the number falls back to a 4-line cap that
 * matches the pre-2026 behavior — fine for the file-list footer where
 * the cap stays approximately right, but DiffViewer's row-budget slice
 * passes a real width so long-bodied threads aren't undercounted.
 */
export function estimateBodyRows(body: string, contentWidth?: number): number {
  const naturalLines = Math.max(1, body.split('\n').length);
  if (contentWidth && contentWidth > 0) {
    const wrapped = Math.max(
      1,
      Math.ceil(body.length / Math.max(1, contentWidth))
    );
    return Math.max(naturalLines, wrapped);
  }
  return Math.min(4, naturalLines);
}

/**
 * Mirror of `estimateCardRows` for local drafts. Selected/editing cards
 * show the full body; collapsed cards cap at 4 lines (matching the
 * runtime MAX_COLLAPSED in <LocalCommentCard>).
 */
export function estimateLocalCardRows(
  comment: ReviewComment,
  contentWidth?: number,
  selected = false
): number {
  const naturalLines = Math.max(1, comment.body.split('\n').length);
  const bodyRows = selected
    ? estimateBodyRows(comment.body, contentWidth)
    : Math.min(4, naturalLines);
  // border-top + header + body + border-bottom + marginBottom
  return 2 + 1 + bodyRows + 1;
}

/**
 * Shared layout decision for the diff-file-list PR-comments footer.
 * Returns every thread (no artificial cap) along with the estimated
 * total rows they'd occupy so the container can reserve space for the
 * scroll window.
 *
 * Earlier versions capped at half-pane height with a "+N more
 * (Shift+C for full view)" tail; that felt arbitrary and the tail
 * hint didn't actually do anything from the file-list context.
 * Rendering everything lets Ink's overflow clip naturally and j/k
 * through comments stays consistent with what's drawn.
 */
export function planCommentFooter(threads: RemoteCommentThread[]): {
  shown: RemoteCommentThread[];
  rows: number;
} {
  if (threads.length === 0) return { shown: [], rows: 0 };
  // +1 for the "PR Comments (N)" heading
  let rows = 1;
  for (const thread of threads) rows += estimateCardRows(thread);
  return { shown: threads, rows };
}
