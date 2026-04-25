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
  estimateCardRows,
  estimateLocalCardRows,
} from '../../components/CommentThread.js';
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
  // Card content area = card width minus borders (2) and paddingX (2).
  const cardContentWidth = Math.max(1, cardWidth - 4);

  // Slice annotated lines by accumulated PHYSICAL rows, not by slot
  // count. Each diff/separator line is one physical row, but a card
  // renders many — so the previous slot-based slice would pack
  // `paneRows-3` slots into a paneRows-row pane, and Yoga would
  // collapse the overflow by overlaying the last card's bottom border
  // on its body and dropping the header row. With long-bodied threads
  // near the bottom of a long file that produced the
  // `[v]reopen`-floating-outside-the-card glitch users reported.
  const visibleLines: AnnotatedLine[] = [];
  let rowsUsed = 0;
  for (let i = scrollOffset; i < annotatedLines.length; i++) {
    const entry = annotatedLines[i]!;
    const r =
      entry.type === 'thread-remote'
        ? estimateCardRows(
            entry.thread,
            cardContentWidth,
            selectedCommentId === entry.thread.id
          )
        : entry.type === 'thread-local'
        ? estimateLocalCardRows(
            entry.comment,
            cardContentWidth,
            selectedCommentId === entry.comment.id
          )
        : 1;
    if (rowsUsed + r > viewportHeight && visibleLines.length > 0) break;
    visibleLines.push(entry);
    rowsUsed += r;
  }
  const totalLines = annotatedLines.length;
  const atTop = scrollOffset === 0;
  const atBottom = scrollOffset + visibleLines.length >= totalLines;

  const hasComments = annotatedLines.some(
    (l) => l.type === 'thread-remote' || l.type === 'thread-local'
  );

  const language = languageFromFilename(filename);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box gap={1}>
        <Text bold color="blue">
          {filename}
          {!loading && totalLines > 0 && (
            <Text dimColor>
              {' '}
              ({scrollOffset + 1}-
              {Math.min(scrollOffset + viewportHeight, totalLines)}/{totalLines}
              )
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

      {!loading && totalLines === 0 && (
        <Text dimColor>(no diff for this file)</Text>
      )}

      {visibleLines.length > 0 && (
        <Box flexDirection="column">
          {!atTop && <Text dimColor>↑ {scrollOffset} lines above</Text>}
          {visibleLines.map((line, i) => {
            const key = scrollOffset + i;
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
          })}
          {!atBottom && (
            <Text dimColor>
              ↓ {totalLines - scrollOffset - viewportHeight} lines below
            </Text>
          )}
        </Box>
      )}

      <DiffViewerHints hasComments={hasComments} hasSections={hasSections} />
    </Box>
  );
});
