import { memo } from 'react';
import { Text, Box } from 'ink';
import type { AnnotatedLine } from '@kirby/review-comments';
import { useKeybindResolve } from '../../context/KeybindContext.js';

// Separate component to isolate context subscription from memo'd parent
function DiffViewerHints({ hasComments }: { hasComments: boolean }) {
  const kb = useKeybindResolve();
  const scrollKeys = kb.getHintKeys('diff-viewer.scroll-down');
  const halfPageKeys = kb.getHintKeys('diff-viewer.half-page-down');
  const topKeys = kb.getHintKeys('diff-viewer.go-top');
  const bottomKeys = kb.getHintKeys('diff-viewer.go-bottom');
  const nextFileKeys = kb.getHintKeys('diff-viewer.next-file');
  const prevFileKeys = kb.getHintKeys('diff-viewer.prev-file');
  const nextCommentKeys = kb.getHintKeys('diff-viewer.next-comment');
  const prevCommentKeys = kb.getHintKeys('diff-viewer.prev-comment');
  const backKeys = kb.getHintKeys('diff-viewer.back');

  return (
    <Box marginTop={1}>
      <Text dimColor>
        <Text color="cyan">{scrollKeys}</Text> scroll ·{' '}
        <Text color="cyan">{halfPageKeys}</Text> half-page ·{' '}
        <Text color="cyan">
          {topKeys}/{bottomKeys}
        </Text>{' '}
        top/bottom ·{' '}
        <Text color="cyan">
          {nextFileKeys}/{prevFileKeys}
        </Text>{' '}
        next/prev file ·{' '}
        {hasComments && (
          <>
            <Text color="cyan">
              {nextCommentKeys}/{prevCommentKeys}
            </Text>{' '}
            comments ·{' '}
          </>
        )}
        <Text color="cyan">{backKeys}</Text> back
      </Text>
    </Box>
  );
}

export const DiffViewer = memo(function DiffViewer({
  filename,
  annotatedLines,
  scrollOffset,
  paneRows,
  paneCols,
  loading,
}: {
  filename: string;
  annotatedLines: AnnotatedLine[];
  scrollOffset: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
}) {
  // Chrome: header + divider + hints = 3 lines
  const viewportHeight = Math.max(1, paneRows - 3);
  const visibleLines = annotatedLines.slice(
    scrollOffset,
    scrollOffset + viewportHeight
  );
  const totalLines = annotatedLines.length;
  const atTop = scrollOffset === 0;
  const atBottom = scrollOffset + viewportHeight >= totalLines;

  const hasComments = annotatedLines.some((l) => l.type === 'comment-header');

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color="blue">
        {filename}
        {loading && <Text color="yellow"> loading diff...</Text>}
        {!loading && totalLines > 0 && (
          <Text dimColor>
            {' '}
            ({scrollOffset + 1}-
            {Math.min(scrollOffset + viewportHeight, totalLines)}/{totalLines})
          </Text>
        )}
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(40, paneCols - 2))}</Text>

      {!loading && totalLines === 0 && (
        <Text dimColor>(no diff for this file)</Text>
      )}

      {visibleLines.length > 0 && (
        <Box flexDirection="column">
          {!atTop && <Text dimColor>↑ {scrollOffset} lines above</Text>}
          {visibleLines.map((line, i) => (
            <Text key={scrollOffset + i} wrap="truncate">
              {line.rendered}
            </Text>
          ))}
          {!atBottom && (
            <Text dimColor>
              ↓ {totalLines - scrollOffset - viewportHeight} lines below
            </Text>
          )}
        </Box>
      )}

      <DiffViewerHints hasComments={hasComments} />
    </Box>
  );
});
