import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { DiffFile, ReviewComment } from '../../types.js';
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
  commentCount,
  hasAnyComments,
}: {
  file: DiffFile;
  selected: boolean;
  maxWidth: number;
  commentCount: number;
  hasAnyComments: boolean;
}) {
  const badge = statusBadge(file.status);
  const prefix = selected ? '› ' : '  ';
  const stats = ` +${file.additions} -${file.deletions}`;

  // Comment count badge on LEFT side: "N💬 " or padding for alignment
  // Widest realistic badge: "99💬 " = 5 chars (count + emoji + space)
  const badgeWidth = hasAnyComments ? 4 : 0;
  const commentBadgeStr = commentCount > 0 ? `${commentCount}` : '';
  const commentPad = hasAnyComments
    ? ' '.repeat(Math.max(0, badgeWidth - commentBadgeStr.length))
    : '';

  const nameWidth = Math.max(
    10,
    maxWidth - prefix.length - 2 - badgeWidth - stats.length - 1
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
      {commentCount > 0 && <Text color="yellow">{commentBadgeStr} </Text>}
      {commentCount === 0 && hasAnyComments && <Text>{commentPad}</Text>}
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
  comments,
}: {
  files: DiffFile[];
  selectedIndex: number;
  paneRows: number;
  paneCols: number;
  loading: boolean;
  error: string | null;
  showSkipped: boolean;
  comments?: ReviewComment[];
}) {
  const { normal, skipped } = partitionFiles(files);
  const displayFiles = showSkipped ? [...normal, ...skipped] : normal;

  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!comments) return counts;
    for (const c of comments) {
      counts.set(c.file, (counts.get(c.file) ?? 0) + 1);
    }
    return counts;
  }, [comments]);

  const hasAnyComments = commentCounts.size > 0;

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
                commentCount={commentCounts.get(f.filename) ?? 0}
                hasAnyComments={hasAnyComments}
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
