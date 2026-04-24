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
      <Box>
        <Text bold color={selected ? 'cyan' : 'blue'}>
          {rootComment.author}
        </Text>
        <Text dimColor> · {relativeTime(rootComment.createdAt)}</Text>
        {thread.isResolved && <Text color="green"> ✓ resolved</Text>}
        {thread.isOutdated && <Text dimColor> (outdated)</Text>}
        {selected && !isReplying && (
          <Text dimColor>
            {'  '}[r]eply [v]{thread.isResolved ? 'reopen' : 'resolve'}
          </Text>
        )}
        {isReplying && (
          <>
            <Text color="cyan">{'  '}REPLY</Text>
            <Text dimColor> [enter] send · [esc] cancel</Text>
          </>
        )}
      </Box>
      <Text wrap="wrap">{rootComment.body}</Text>
      {thread.comments.length > 1 && (
        <Box flexDirection="column" marginTop={1}>
          {thread.comments.slice(1).map((reply) => (
            <Box key={reply.id} flexDirection="column" marginLeft={2}>
              <Box>
                <Text bold color="blue">
                  {reply.author}
                </Text>
                <Text dimColor> · {relativeTime(reply.createdAt)}</Text>
              </Box>
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
      <Box>
        <Text bold color={severityColor}>
          [{comment.severity}]
        </Text>
        {statusMark && <Text color={statusMark.color}> {statusMark.char}</Text>}
        {pendingDelete && <Text color="red">{'  '}Delete? [y]es [n]o</Text>}
        {selected && !editing && !pendingDelete && (
          <Text dimColor>{'  '}[e]dit [x]delete [p]ost</Text>
        )}
        {editing && (
          <>
            <Text color="cyan">{'  '}EDITING</Text>
            <Text dimColor> [esc] save · [ctrl+c] cancel</Text>
          </>
        )}
      </Box>
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
export function estimateCardRows(thread: RemoteCommentThread): number {
  const root = thread.comments[0];
  if (!root) return 0;
  const BODY_LINE_CAP = 4;
  const rootBodyLines = Math.min(
    BODY_LINE_CAP,
    Math.max(1, root.body.split('\n').length)
  );
  // border-top + author row + body + border-bottom + marginBottom
  const rootRows = 2 + 1 + rootBodyLines + 1;
  // per reply: author row + body (1 line approx) + marginTop gap
  const replyRows = Math.max(0, thread.comments.length - 1) * 3;
  return rootRows + replyRows;
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
