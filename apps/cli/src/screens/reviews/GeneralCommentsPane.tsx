import { memo } from 'react';
import { Box, Text } from 'ink';
import type { RemoteCommentThread } from '@kirby/vcs-core';

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
          const selected = absoluteIdx === selectedIndex;
          const rootComment = thread.comments[0];
          if (!rootComment) return null;

          return (
            <Box
              key={thread.id}
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
              {replyingToThreadId === thread.id && (
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
        })}
      </Box>
    </Box>
  );
});
