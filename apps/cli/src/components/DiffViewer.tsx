import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import { parseUnifiedDiff } from '../utils/diff-parser.js';
import { renderDiffLines } from '../utils/diff-renderer.js';

export const DiffViewer = memo(function DiffViewer({
  filename,
  diffText,
  scrollOffset,
  paneRows,
  paneCols,
  loading,
}: {
  filename: string;
  diffText: string | null;
  scrollOffset: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
}) {
  const renderedLines = useMemo(() => {
    if (!diffText) return [];
    const allFileDiffs = parseUnifiedDiff(diffText);
    const fileDiffLines = allFileDiffs.get(filename);
    if (!fileDiffLines) return [];
    return renderDiffLines(fileDiffLines, paneCols);
  }, [diffText, filename, paneCols]);

  // Chrome: header + divider + hints = 3 lines
  const viewportHeight = Math.max(1, paneRows - 3);
  const visibleLines = renderedLines.slice(
    scrollOffset,
    scrollOffset + viewportHeight
  );
  const totalLines = renderedLines.length;
  const atTop = scrollOffset === 0;
  const atBottom = scrollOffset + viewportHeight >= totalLines;

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
              {line}
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
          <Text color="cyan">j/k</Text> scroll ·{' '}
          <Text color="cyan">d/u</Text> half-page ·{' '}
          <Text color="cyan">g/G</Text> top/bottom ·{' '}
          <Text color="cyan">n/N</Text> next/prev file ·{' '}
          <Text color="cyan">esc</Text> back
        </Text>
      </Box>
    </Box>
  );
});
