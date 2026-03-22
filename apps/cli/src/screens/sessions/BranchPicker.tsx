import { memo } from 'react';
import { Text, Box } from 'ink';
import { computeScrollWindow } from '../../utils/scroll-window.js';

export const BranchPicker = memo(function BranchPicker({
  filter,
  branches,
  selectedIndex,
  paneRows,
}: {
  filter: string;
  branches: string[];
  selectedIndex: number;
  paneRows: number;
}) {
  const filtered = branches.filter((b) =>
    b.toLowerCase().includes(filter.toLowerCase())
  );
  const hasExactMatch = branches.some(
    (b) => b.toLowerCase() === filter.toLowerCase()
  );
  const showCreateHint =
    filter.length > 0 && !hasExactMatch && filtered.length > 0;

  // Windowed rendering: derive visible slice from props
  const chromeRows = 3 + (showCreateHint ? 2 : 0); // title + divider + hints + optional create hint
  const maxVisible = Math.max(1, paneRows - chromeRows);
  const needsIndicators = filtered.length > maxVisible;
  const indicatorRows = needsIndicators ? 2 : 0;
  const listRows = maxVisible - indicatorRows;

  const { windowStart, aboveCount, belowCount } = computeScrollWindow({
    totalItems: filtered.length,
    selectedIndex,
    maxVisible: listRows,
  });
  const visibleBranches = filtered.slice(
    windowStart,
    windowStart + Math.max(1, listRows)
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Text bold color="yellow">
        Branch Picker
        {filter.length > 0 && (
          <Text dimColor>
            {' '}
            / {filter}
            <Text color="cyan">_</Text>
          </Text>
        )}
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Text dimColor>
        <Text color="cyan">↑↓</Text> navigate · <Text color="cyan">Ctrl+f</Text>{' '}
        fetch · <Text color="cyan">Enter</Text> select ·{' '}
        <Text color="cyan">Esc</Text> cancel
      </Text>
      {filtered.length === 0 ? (
        <Box flexDirection="column">
          {filter.length > 0 ? (
            <Text color="yellow">
              (new branch) <Text bold>{filter}</Text>
            </Text>
          ) : (
            <Text dimColor>Type to filter branches...</Text>
          )}
        </Box>
      ) : (
        <Box flexDirection="column">
          {aboveCount > 0 && <Text dimColor>↑ {aboveCount} more</Text>}
          {visibleBranches.map((b, i) => {
            const realIndex = windowStart + i;
            const isSelected = realIndex === selectedIndex;
            return (
              <Text key={b}>
                <Text color={isSelected ? 'cyan' : undefined}>
                  {isSelected ? '› ' : '  '}
                </Text>
                <Text bold={isSelected}>{b}</Text>
              </Text>
            );
          })}
          {belowCount > 0 && <Text dimColor>↓ {belowCount} more</Text>}
          {showCreateHint && (
            <Box marginTop={1}>
              <Text dimColor>
                Enter to create: <Text color="yellow">{filter}</Text>
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
});
