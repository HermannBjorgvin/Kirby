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
}

export const CommentThreadCard = memo(function CommentThreadCard({
  thread,
  selected = false,
  replyingToThreadId,
  replyBuffer,
}: CommentThreadCardProps) {
  const rootComment = thread.comments[0];
  if (!rootComment) return null;

  const isReplying = replyingToThreadId === thread.id;

  return (
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
    >
      <Box>
        <Text bold color={selected ? 'cyan' : undefined}>
          {rootComment.author}
        </Text>
        <Text dimColor> · {relativeTime(rootComment.createdAt)}</Text>
        {thread.isResolved && <Text color="green"> ✓ resolved</Text>}
      </Box>
      <Text wrap="wrap">{rootComment.body}</Text>
      {thread.comments.length > 1 && (
        <Box flexDirection="column" marginTop={1}>
          {thread.comments.slice(1).map((reply) => (
            <Box key={reply.id} flexDirection="column" marginLeft={2}>
              <Box>
                <Text bold dimColor>
                  {reply.author}
                </Text>
                <Text dimColor> · {relativeTime(reply.createdAt)}</Text>
              </Box>
              <Text wrap="wrap" dimColor>
                {reply.body}
              </Text>
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
          <Text dimColor>Your reply · [enter] post · [esc] cancel</Text>
          <Text>{replyBuffer ?? ''}▍</Text>
        </Box>
      )}
    </Box>
  );
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
}

export const LocalCommentCard = memo(function LocalCommentCard({
  comment,
  selected = false,
  pendingDelete = false,
  editing = false,
  editBuffer,
}: LocalCommentCardProps) {
  const severityColor = SEVERITY_COLOR[comment.severity] ?? 'gray';
  const statusMark = STATUS_MARK[comment.status];
  // Collapse body to 4 lines when not selected (same policy the ANSI
  // renderer used, preserved for visual continuity).
  const bodyLines = comment.body.split('\n');
  const MAX_COLLAPSED = 4;
  const shownLines =
    selected || editing ? bodyLines : bodyLines.slice(0, MAX_COLLAPSED);
  const truncated = !selected && !editing && bodyLines.length > MAX_COLLAPSED;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={selected ? 'yellow' : 'gray'}
      marginBottom={1}
      paddingX={1}
    >
      <Box>
        <Text bold color={severityColor}>
          [{comment.severity}]
        </Text>
        {statusMark && <Text color={statusMark.color}> {statusMark.char}</Text>}
        {pendingDelete && <Text color="red"> Delete? [y]es [n]o</Text>}
        {selected && !editing && !pendingDelete && (
          <Text dimColor> [e]dit [x]delete [p]ost</Text>
        )}
        {editing && (
          <Text>
            <Text color="cyan"> EDITING</Text>
            <Text dimColor> [esc] save · [ctrl+c] cancel</Text>
          </Text>
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
 * Given the full thread list and the pane's row budget, returns the
 * prefix that fits (≤ half the pane) plus the reserved row count and
 * the overflow tail.
 *
 * Having the container and the renderer call the same helper keeps
 * navigation bounds (set by the container) and the rendered cards (by
 * the list) in sync — j/k never stops on a thread that isn't drawn.
 */
export function planCommentFooter(
  threads: RemoteCommentThread[],
  paneRows: number
): {
  shown: RemoteCommentThread[];
  rows: number;
  overflow: number;
} {
  if (threads.length === 0) {
    return { shown: [], rows: 0, overflow: 0 };
  }
  const maxFooterRows = Math.max(6, Math.floor(paneRows / 2));
  const shown: RemoteCommentThread[] = [];
  // +1 for the "PR Comments (N)" heading
  let rows = 1;
  for (const thread of threads) {
    const cost = estimateCardRows(thread);
    if (rows + cost > maxFooterRows) break;
    rows += cost;
    shown.push(thread);
  }
  const overflow = threads.length - shown.length;
  if (overflow > 0) rows += 1; // "+N more" tail
  return { shown, rows, overflow };
}
