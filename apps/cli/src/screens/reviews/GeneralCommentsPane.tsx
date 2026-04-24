import { memo } from 'react';
import { Box, Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { CommentThreadCard } from '../../components/CommentThread.js';

export const GeneralCommentsPane = memo(function GeneralCommentsPane({
  comments,
  selectedIndex,
  scrollOffset,
  paneRows,
  replyingToThreadId,
  replyBuffer,
}: {
  comments: RemoteCommentThread[];
  selectedIndex: number;
  scrollOffset: number;
  paneRows: number;
  replyingToThreadId?: string | null;
  replyBuffer?: string;
}) {
  if (comments.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1} paddingTop={1}>
        <Text dimColor>No general comments on this PR.</Text>
        <Text dimColor>Press [esc] to go back.</Text>
      </Box>
    );
  }

  const viewportHeight = Math.max(1, paneRows - 2);
  const visibleComments = comments.slice(
    scrollOffset,
    scrollOffset + viewportHeight
  );

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        <Text bold>PR Comments ({comments.length})</Text>
        <Text dimColor> [esc] back · [j/k] navigate · [r] reply</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {visibleComments.map((thread, idx) => {
          const absoluteIdx = scrollOffset + idx;
          return (
            <CommentThreadCard
              key={thread.id}
              thread={thread}
              selected={absoluteIdx === selectedIndex}
              replyingToThreadId={replyingToThreadId}
              replyBuffer={replyBuffer}
            />
          );
        })}
      </Box>
    </Box>
  );
});
