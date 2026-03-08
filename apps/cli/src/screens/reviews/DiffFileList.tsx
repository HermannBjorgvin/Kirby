import { memo } from 'react';
import { Text, Box } from 'ink';
import type { DiffFile } from '../../types.js';
import { partitionFiles } from '../../utils/file-classifier.js';
import { truncate } from '../../utils/truncate.js';
import { computeScrollWindow } from '../../hooks/useScrollWindow.js';

function statusBadge(status: DiffFile['status']): {
  char: string;
  color: string;
} {
  switch (status) {
    case 'added':
      return { char: 'A', color: 'green' };
    case 'removed':
      return { char: 'D', color: 'red' };
    case 'renamed':
      return { char: 'R', color: 'cyan' };
    case 'copied':
      return { char: 'C', color: 'cyan' };
    case 'changed':
      return { char: 'C', color: 'yellow' };
    default:
      return { char: 'M', color: 'yellow' };
  }
}

function FileRow({
  file,
  selected,
  maxWidth,
}: {
  file: DiffFile;
  selected: boolean;
  maxWidth: number;
}) {
  const badge = statusBadge(file.status);
  // "› A filename.ts  +10 -5"
  const prefix = selected ? '› ' : '  ';
  const stats = ` +${file.additions} -${file.deletions}`;
  const nameWidth = Math.max(
    10,
    maxWidth - prefix.length - 2 - stats.length - 1
  );
  const name = file.previousFilename
    ? `${truncate(
        file.previousFilename,
        Math.floor(nameWidth / 2)
      )} → ${truncate(file.filename, Math.ceil(nameWidth / 2))}`
    : truncate(file.filename, nameWidth);

  return (
    <Text>
      <Text color={selected ? 'cyan' : undefined}>{prefix}</Text>
      <Text color={badge.color}>{badge.char}</Text>{' '}
      <Text bold={selected}>{name}</Text>
      <Text color="green"> +{file.additions}</Text>
      <Text color="red"> -{file.deletions}</Text>
    </Text>
  );
}

export const DiffFileList = memo(function DiffFileList({
  files,
  selectedIndex,
  paneRows,
  paneCols,
  loading,
  error,
  showSkipped,
}: {
  files: DiffFile[];
  selectedIndex: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
  error: string | null;
  showSkipped: boolean;
}) {
  const { normal, skipped } = partitionFiles(files);
  const displayFiles = showSkipped ? [...normal, ...skipped] : normal;

  // Chrome: title + divider + hints + optional warning + optional skipped header
  const chromeRows = 4;
  const maxVisible = Math.max(1, paneRows - chromeRows);
  const needsIndicators = displayFiles.length > maxVisible;
  const indicatorRows = needsIndicators ? 2 : 0;
  const listRows = maxVisible - indicatorRows;

  const { windowStart, aboveCount, belowCount } = computeScrollWindow({
    totalItems: displayFiles.length,
    selectedIndex,
    maxVisible: listRows,
  });
  const visibleFiles = displayFiles.slice(
    windowStart,
    windowStart + Math.max(1, listRows)
  );

  const maxWidth = Math.max(20, paneCols - 2);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color="blue">
        Files Changed ({files.length})
        {loading && <Text color="yellow"> loading...</Text>}
      </Text>
      <Text dimColor>{'─'.repeat(Math.min(40, maxWidth))}</Text>

      {error && <Text color="red">Error: {error}</Text>}

      {files.length > 500 && (
        <Text color="yellow">Large PR: {files.length} files</Text>
      )}

      {!loading && !error && displayFiles.length === 0 && (
        <Text dimColor>(no files)</Text>
      )}

      {displayFiles.length > 0 && (
        <Box flexDirection="column">
          {aboveCount > 0 && <Text dimColor>↑ {aboveCount} more</Text>}
          {visibleFiles.map((f, i) => {
            const realIndex = windowStart + i;
            const isSelected = realIndex === selectedIndex;
            return (
              <FileRow
                key={f.filename}
                file={f}
                selected={isSelected}
                maxWidth={maxWidth}
              />
            );
          })}
          {belowCount > 0 && <Text dimColor>↓ {belowCount} more</Text>}
        </Box>
      )}

      {skipped.length > 0 && !showSkipped && (
        <Text dimColor>
          {skipped.length} skipped (binary/lock/generated) ·{' '}
          <Text color="cyan">s</Text> to show
        </Text>
      )}
      {skipped.length > 0 && showSkipped && (
        <Text dimColor>
          showing all · <Text color="cyan">s</Text> to hide skipped
        </Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          <Text color="cyan">j/k</Text> navigate ·{' '}
          <Text color="cyan">enter</Text> view diff ·{' '}
          <Text color="cyan">esc</Text> back
        </Text>
      </Box>
    </Box>
  );
});
