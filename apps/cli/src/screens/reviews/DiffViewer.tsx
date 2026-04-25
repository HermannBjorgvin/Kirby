import { memo } from 'react';
import { Text, Box } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { AnnotatedLine } from '@kirby/review-comments';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import {
  CommentThreadCard,
  LocalCommentCard,
  CARD_MAX_WIDTH,
  CARD_INDENT,
} from '../../components/CommentThread.js';
import type { RowMap } from '@kirby/review-comments';
import { DiffRow } from './DiffRow.js';
import { languageFromFilename } from '../../utils/language.js';

// Separate component to isolate context subscription from memo'd parent
function DiffViewerHints({
  hasComments,
  hasSections,
}: {
  hasComments: boolean;
  hasSections: boolean;
}) {
  const kb = useKeybindResolve();
  const scrollKeys = kb.getHintKeys('diff-viewer.scroll-down');
  const halfPageKeys = kb.getHintKeys('diff-viewer.half-page-down');
  const topKeys = kb.getHintKeys('diff-viewer.go-top');
  const bottomKeys = kb.getHintKeys('diff-viewer.go-bottom');
  const nextFileKeys = kb.getHintKeys('diff-viewer.next-file');
  const prevFileKeys = kb.getHintKeys('diff-viewer.prev-file');
  const nextCommentKeys = kb.getHintKeys('diff-viewer.next-comment');
  const prevCommentKeys = kb.getHintKeys('diff-viewer.prev-comment');
  const nextSectionKeys = kb.getHintKeys('diff-viewer.next-section');
  const prevSectionKeys = kb.getHintKeys('diff-viewer.prev-section');
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
        {hasSections && (
          <>
            <Text color="cyan">
              {nextSectionKeys}/{prevSectionKeys}
            </Text>{' '}
            sections ·{' '}
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
}) {
  // Chrome: header + divider + hints = 3 lines
  const viewportHeight = Math.max(1, paneRows - 3);
  const cardWidth = Math.max(
    20,
    Math.min(CARD_MAX_WIDTH, paneCols - CARD_INDENT - 2)
  );

  // Row-based slice: pick every entry whose [rowStart, rowStart+rowSpan]
  // overlaps the viewport's [scrollOffset, scrollOffset+viewportHeight]
  // range. The first overlapping entry may have its top clipped — we
  // render it inside a Box with marginTop={-topClip} so the visible
  // portion aligns with scrollOffset. The probe in commit history
  // (apps/cli/src/_probe/ink-clip.tsx) confirmed Ink/Yoga handles this
  // cleanly with `flexShrink={0}` on each child + `overflow="hidden"`
  // on the parent.
  const viewportTop = scrollOffset;
  const viewportBottom = scrollOffset + viewportHeight;
  const visibleEntries: {
    entry: AnnotatedLine;
    sourceIndex: number;
    topClip: number;
  }[] = [];
  for (let i = 0; i < annotatedLines.length; i++) {
    const pos = rowMap.positions[i];
    if (!pos) continue;
    const top = pos.rowStart;
    const bottom = pos.rowStart + pos.rowSpan;
    if (bottom <= viewportTop) continue;
    if (top >= viewportBottom) break;
    visibleEntries.push({
      entry: annotatedLines[i]!,
      sourceIndex: i,
      topClip: Math.max(0, viewportTop - top),
    });
  }

  const totalRows = rowMap.totalRows;
  const atTop = scrollOffset === 0;
  const atBottom = scrollOffset + viewportHeight >= totalRows;
  const rowsAbove = scrollOffset;
  const rowsBelow = Math.max(0, totalRows - (scrollOffset + viewportHeight));

  const hasComments = annotatedLines.some(
    (l) => l.type === 'thread-remote' || l.type === 'thread-local'
  );

  const language = languageFromFilename(filename);

  // Reserve one viewport row for each scroll indicator we'll render
  // (↑ / ↓), so the body region stays bounded by `viewportHeight` even
  // when the indicators occupy a row. Without this the indicators
  // would push entries past the bottom edge.
  const indicatorRows = (atTop ? 0 : 1) + (atBottom ? 0 : 1);
  const bodyHeight = Math.max(1, viewportHeight - indicatorRows);

  function renderEntry(line: AnnotatedLine, key: string | number) {
    if (line.type === 'diff') {
      return (
        <DiffRow
          key={key}
          line={line.line}
          highlighted={line.highlighted}
          language={language}
          paneCols={paneCols}
        />
      );
    }
    if (line.type === 'separator') {
      return (
        <Text key={key} wrap="truncate">
          {line.rendered}
        </Text>
      );
    }
    if (line.type === 'thread-remote') {
      return (
        <CommentThreadCard
          key={`r:${line.thread.id}`}
          thread={line.thread}
          selected={selectedCommentId === line.thread.id}
          replyingToThreadId={replyingToThreadId}
          replyBuffer={replyBuffer}
          maxWidth={cardWidth}
          indent={CARD_INDENT}
        />
      );
    }
    return (
      <LocalCommentCard
        key={`l:${line.comment.id}`}
        comment={line.comment}
        selected={selectedCommentId === line.comment.id}
        pendingDelete={pendingDeleteCommentId === line.comment.id}
        editing={editingCommentId === line.comment.id}
        editBuffer={
          editingCommentId === line.comment.id ? editBuffer : undefined
        }
        maxWidth={cardWidth}
        indent={CARD_INDENT}
      />
    );
  }

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

      {visibleEntries.length > 0 && (
        <>
          {!atTop && <Text dimColor>↑ {rowsAbove} rows above</Text>}
          <Box
            flexDirection="column"
            height={bodyHeight}
            overflow="hidden"
            flexShrink={0}
          >
            {visibleEntries.map(({ entry, sourceIndex, topClip }, i) => {
              const key = `${sourceIndex}`;
              const node = renderEntry(entry, key);
              // First entry may be partly above the viewport — shift
              // it up by `topClip` rows. flexShrink={0} prevents Yoga
              // from squeezing the entry to fit (which previously
              // caused the bottom-border-overlay corruption).
              if (i === 0 && topClip > 0) {
                return (
                  <Box key={`clip:${key}`} flexShrink={0} marginTop={-topClip}>
                    {node}
                  </Box>
                );
              }
              return (
                <Box key={`wrap:${key}`} flexShrink={0}>
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
