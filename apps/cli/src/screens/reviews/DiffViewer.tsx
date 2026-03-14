import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import { parseUnifiedDiff } from '../../utils/diff-parser.js';
import { renderDiffLines } from '../../utils/diff-renderer.js';
import { interleaveComments } from '../../utils/comment-renderer.js';
import type { ReviewComment } from '../../types.js';

export const DiffViewer = memo(function DiffViewer({
  filename,
  diffText,
  scrollOffset,
  paneRows,
  paneCols,
  loading,
  comments,
  selectedCommentId,
  pendingDeleteCommentId,
  editingCommentId,
  editBuffer,
}: {
  filename: string;
  diffText: string | null;
  scrollOffset: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
  comments?: ReviewComment[];
  selectedCommentId?: string | null;
  pendingDeleteCommentId?: string | null;
  editingCommentId?: string | null;
  editBuffer?: string;
}) {
  // Step 1: Parse + render diff (only re-runs when diff text or dimensions change)
  const parsedDiff = useMemo(() => {
    if (!diffText) return null;
    const allFileDiffs = parseUnifiedDiff(diffText);
    const fileDiffLines = allFileDiffs.get(filename);
    if (!fileDiffLines) return null;
    const rendered = renderDiffLines(fileDiffLines, paneCols);
    return { fileDiffLines, rendered };
  }, [diffText, filename, paneCols]);

  // Step 2: Interleave comments (re-runs when comments or selection changes)
  const annotatedLines = useMemo(() => {
    if (!parsedDiff) return [];
    const { fileDiffLines, rendered } = parsedDiff;

    if (!comments || comments.length === 0) {
      return rendered.map((line) => ({
        type: 'diff' as const,
        rendered: line,
      }));
    }

    const fileComments = comments.filter((c) => c.file === filename);
    return interleaveComments(
      fileDiffLines,
      rendered,
      fileComments,
      paneCols,
      selectedCommentId ?? null,
      pendingDeleteCommentId,
      editingCommentId,
      editBuffer
    );
  }, [
    parsedDiff,
    filename,
    paneCols,
    comments,
    selectedCommentId,
    pendingDeleteCommentId,
    editingCommentId,
    editBuffer,
  ]);

  // Chrome: header + divider + hints = 3 lines
  const viewportHeight = Math.max(1, paneRows - 3);
  const visibleLines = annotatedLines.slice(
    scrollOffset,
    scrollOffset + viewportHeight
  );
  const totalLines = annotatedLines.length;
  const atTop = scrollOffset === 0;
  const atBottom = scrollOffset + viewportHeight >= totalLines;

  const hasComments = comments && comments.some((c) => c.file === filename);

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

      {!loading && totalLines === 0 && diffText !== null && (
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

      <Box marginTop={1}>
        <Text dimColor>
          <Text color="cyan">j/k</Text> scroll · <Text color="cyan">d/u</Text>{' '}
          half-page · <Text color="cyan">PgUp/Dn</Text> page ·{' '}
          <Text color="cyan">g/G</Text> top/bottom ·{' '}
          <Text color="cyan">n/N</Text> next/prev file ·{' '}
          {hasComments && (
            <>
              <Text color="cyan">←/→ c/C</Text> comments ·{' '}
            </>
          )}
          <Text color="cyan">esc</Text> back
        </Text>
      </Box>
    </Box>
  );
});
