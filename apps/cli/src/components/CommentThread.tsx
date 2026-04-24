import { memo } from 'react';
import { Box, Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';

// Shared Ink-based renderings for remote comment threads.
//
// Consumers today:
//   - GeneralCommentsPane (Shift+C)       → <CommentThreadCard>
//   - DiffFileList PR-comments footer     → <CommentThreadLine>
//
// The diff viewer goes a different route: it renders ANSI-annotated
// lines through @kirby/review-comments so threads can interleave with
// diff rows under a single scroll offset. That pipeline stays on the
// `renderRemoteThread` helper in the lib; this file is only for the
// Ink-primitive surfaces.

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
      borderStyle={selected ? 'round' : undefined}
      borderColor={selected ? 'cyan' : undefined}
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

// ── One-line preview ─────────────────────────────────────────────────

interface CommentThreadLineProps {
  thread: RemoteCommentThread;
  /** Max visible character width for the line — used to truncate body. */
  maxWidth: number;
}

export const CommentThreadLine = memo(function CommentThreadLine({
  thread,
  maxWidth,
}: CommentThreadLineProps) {
  const root = thread.comments[0];
  if (!root) return null;
  const stamp = relativeTime(root.createdAt);
  const replies = thread.comments.length - 1;
  const suffix =
    replies > 0 ? ` · ${replies} repl${replies === 1 ? 'y' : 'ies'}` : '';
  // Collapse newlines so the preview stays on one line.
  const body = root.body.replace(/\s+/g, ' ').trim();
  const header = `${root.author} · ${stamp}${suffix}: `;
  const bodyBudget = Math.max(10, maxWidth - header.length - 2);
  const preview =
    body.length > bodyBudget ? `${body.slice(0, bodyBudget - 1)}…` : body;

  return (
    <Text>
      <Text dimColor>• </Text>
      <Text bold>{root.author}</Text>
      <Text dimColor>
        {' · '}
        {stamp}
        {suffix}
        {': '}
      </Text>
      <Text>{preview}</Text>
    </Text>
  );
});
