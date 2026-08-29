import { memo } from 'react';
import { Text, Box } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { AnnotatedLine, RowMap } from '@kirby/review-comments';
import { languageFromFilename } from '@kirby/core';
import { CARD_MAX_WIDTH, CARD_INDENT } from '../../components/CommentThread.js';
import { diffViewerViewport } from './diff-viewer-viewport.js';
import { DiffViewerEntry, type DiffEntryState } from './DiffViewerEntry.js';
import { DiffViewerHints } from './DiffViewerHints.js';

export const DiffViewer = memo(function DiffViewer({
  filename,
  annotatedLines,
  rowMap,
  scrollOffset,
  paneRows,
  paneCols,
  loading,
  hasSections = false,
  selectedCommentId,
  pendingDeleteCommentId,
  editingCommentId,
  editBuffer,
  replyingToThreadId,
  replyBuffer,
  inPlanKeys,
  annotatingPlanKey,
  annotationBuffer,
}: {
  filename: string;
  annotatedLines: AnnotatedLine[];
  /** Physical-row layout for `annotatedLines`. Built by `buildRowMap`. */
  rowMap: RowMap;
  /** Physical row offset of the viewport's top edge. */
  scrollOffset: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
  hasSections?: boolean;
  selectedCommentId?: string | null;
  pendingDeleteCommentId?: string | null;
  editingCommentId?: string | null;
  editBuffer?: string;
  replyingToThreadId?: string | null;
  replyBuffer?: string;
  /** Keys (`${kind}:${id}`) of comments queued in the plan. */
  inPlanKeys?: Map<string, boolean>;
  /** Plan key currently being annotated (Shift+A composer target). */
  annotatingPlanKey?: string | null;
  annotationBuffer?: string;
}) {
  const cardWidth = Math.max(
    20,
    Math.min(CARD_MAX_WIDTH, paneCols - CARD_INDENT - 2)
  );

  const {
    viewportHeight,
    bodyHeight,
    visible,
    atTop,
    atBottom,
    rowsAbove,
    rowsBelow,
    totalRows,
  } = diffViewerViewport({
    rowMap,
    entryCount: annotatedLines.length,
    scrollOffset,
    paneRows,
  });

  const hasComments = annotatedLines.some(
    (l) => l.type === 'thread-remote' || l.type === 'thread-local'
  );

  const language = languageFromFilename(filename);

  const entryState: DiffEntryState = {
    selectedCommentId,
    pendingDeleteCommentId,
    editingCommentId,
    editBuffer,
    replyingToThreadId,
    replyBuffer,
    inPlanKeys,
    annotatingPlanKey,
    annotationBuffer,
  };

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box gap={1}>
        <Text bold color="blue">
          {filename}
          {!loading && totalRows > 0 && (
            <Text dimColor>
              {' '}
              (rows {scrollOffset + 1}-
              {Math.min(scrollOffset + viewportHeight, totalRows)}/{totalRows})
            </Text>
          )}
        </Text>
        {loading && (
          <>
            <Spinner />
            <Text color="yellow">loading diff...</Text>
          </>
        )}
      </Box>
      <Text dimColor>{'─'.repeat(Math.min(40, paneCols - 2))}</Text>

      {!loading && totalRows === 0 && (
        <Text dimColor>(no diff for this file)</Text>
      )}

      {visible.length > 0 && (
        <>
          {!atTop && <Text dimColor>↑ {rowsAbove} rows above</Text>}
          <Box
            flexDirection="column"
            height={bodyHeight}
            overflow="hidden"
            flexShrink={0}
          >
            {visible.map(({ sourceIndex, topClip }, i) => {
              const node = (
                <DiffViewerEntry
                  line={annotatedLines[sourceIndex]!}
                  language={language}
                  paneCols={paneCols}
                  cardWidth={cardWidth}
                  state={entryState}
                />
              );
              // First entry may be partly above the viewport — shift
              // it up by `topClip` rows. flexShrink={0} prevents Yoga
              // from squeezing the entry to fit (which previously
              // caused the bottom-border-overlay corruption).
              if (i === 0 && topClip > 0) {
                return (
                  <Box
                    key={`clip:${sourceIndex}`}
                    flexShrink={0}
                    marginTop={-topClip}
                  >
                    {node}
                  </Box>
                );
              }
              return (
                <Box key={`wrap:${sourceIndex}`} flexShrink={0}>
                  {node}
                </Box>
              );
            })}
          </Box>
          {!atBottom && <Text dimColor>↓ {rowsBelow} rows below</Text>}
        </>
      )}

      <DiffViewerHints hasComments={hasComments} hasSections={hasSections} />
    </Box>
  );
});
