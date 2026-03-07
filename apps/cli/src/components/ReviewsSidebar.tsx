import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { CategorizedReviews, PullRequestInfo } from '@kirby/vcs-core';
import { PrBadge } from './PrBadge.js';
import { truncate } from '../utils/truncate.js';

type SidebarRow =
  | { kind: 'section-header'; title: string; titleColor: string; count: number }
  | { kind: 'pr-item'; pr: PullRequestInfo };

const LINES_PER_ROW = 3;
const FIXED_CHROME_LINES = 11; // header(2) + footer keybinds(7) + legend(2)

function buildSidebarRows(categorized: CategorizedReviews): SidebarRow[] {
  const rows: SidebarRow[] = [];
  const sections: {
    title: string;
    titleColor: string;
    prs: PullRequestInfo[];
  }[] = [
    {
      title: 'Needs Your Review',
      titleColor: 'red',
      prs: categorized.needsReview,
    },
    {
      title: 'Waiting for Author',
      titleColor: 'yellow',
      prs: categorized.waitingForAuthor,
    },
    {
      title: 'Approved by You',
      titleColor: 'green',
      prs: categorized.approvedByYou,
    },
  ];
  for (const section of sections) {
    if (section.prs.length === 0) continue;
    rows.push({
      kind: 'section-header',
      title: section.title,
      titleColor: section.titleColor,
      count: section.prs.length,
    });
    for (const pr of section.prs) {
      rows.push({ kind: 'pr-item', pr });
    }
  }
  return rows;
}

function computeWindow(
  rows: SidebarRow[],
  selectedPrId: number | undefined,
  paneRows: number
) {
  const totalLines = rows.length * LINES_PER_ROW;
  const availableLines = paneRows - FIXED_CHROME_LINES;

  // If everything fits, no windowing needed
  if (totalLines <= availableLines) {
    return { visibleRows: rows, startIndex: 0, aboveLines: 0, belowLines: 0 };
  }

  // Find selected row index
  let selectedIndex = rows.findIndex(
    (r) => r.kind === 'pr-item' && r.pr.id === selectedPrId
  );
  if (selectedIndex < 0) selectedIndex = 0;

  // Pass 1: assume 2 indicator lines to compute window
  const maxVisibleRows = Math.max(
    1,
    Math.floor((availableLines - 2) / LINES_PER_ROW)
  );

  // Center selection in window
  const halfWindow = Math.floor(maxVisibleRows / 2);
  const maxStart = Math.max(0, rows.length - maxVisibleRows);
  const startIndex = Math.min(
    Math.max(selectedIndex - halfWindow, 0),
    maxStart
  );

  const aboveCount = startIndex;
  const belowCount = Math.max(0, rows.length - startIndex - maxVisibleRows);

  // Pass 2: recalculate with actual indicator count
  const indicatorLines = (aboveCount > 0 ? 1 : 0) + (belowCount > 0 ? 1 : 0);
  const adjustedMaxRows = Math.max(
    1,
    Math.floor((availableLines - indicatorLines) / LINES_PER_ROW)
  );
  const adjustedMaxStart = Math.max(0, rows.length - adjustedMaxRows);
  const adjustedStart = Math.min(
    Math.max(selectedIndex - Math.floor(adjustedMaxRows / 2), 0),
    adjustedMaxStart
  );

  const visibleRows = rows.slice(
    adjustedStart,
    adjustedStart + adjustedMaxRows
  );
  const aboveLines = adjustedStart * LINES_PER_ROW;
  const belowLines =
    Math.max(0, rows.length - adjustedStart - adjustedMaxRows) * LINES_PER_ROW;

  return { visibleRows, startIndex: adjustedStart, aboveLines, belowLines };
}

export const ReviewsSidebar = memo(function ReviewsSidebar({
  categorized,
  selectedPrId,
  sidebarWidth,
  paneRows,
  focused = true,
}: {
  categorized: CategorizedReviews;
  selectedPrId: number | undefined;
  sidebarWidth: number;
  paneRows: number;
  focused?: boolean;
}) {
  const innerWidth = Math.max(10, sidebarWidth - 2);
  const totalItems =
    categorized.needsReview.length +
    categorized.waitingForAuthor.length +
    categorized.approvedByYou.length;

  const allRows = useMemo(() => buildSidebarRows(categorized), [categorized]);
  const { visibleRows, aboveLines, belowLines } = useMemo(
    () => computeWindow(allRows, selectedPrId, paneRows),
    [allRows, selectedPrId, paneRows]
  );

  return (
    <Box flexDirection="column" width={sidebarWidth} paddingX={1}>
      <Text bold color={focused ? 'blue' : 'gray'}>
        Reviews
      </Text>
      <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      {totalItems === 0 ? (
        <Text dimColor>(no reviews assigned to you)</Text>
      ) : (
        <>
          {aboveLines > 0 && (
            <Text dimColor>↑ {aboveLines / LINES_PER_ROW} more</Text>
          )}
          {visibleRows.map((row, index) => {
            if (row.kind === 'section-header') {
              return (
                <Box key={`section-${row.title}`} flexDirection="column">
                  <Box marginTop={index === 0 ? 0 : 1}>
                    <Text bold color={row.titleColor}>
                      {' '}
                      {row.title} ({row.count})
                    </Text>
                  </Box>
                  <Text dimColor> {'─'.repeat(innerWidth - 1)}</Text>
                </Box>
              );
            }
            const selected = row.pr.id === selectedPrId;
            return (
              <Box key={row.pr.id} flexDirection="column">
                <Text>
                  <Text color={selected ? 'cyan' : undefined}>
                    {selected ? '› ' : '  '}
                  </Text>
                  <Text bold={selected}>
                    {truncate(
                      row.pr.title || row.pr.sourceBranch,
                      innerWidth - 4
                    )}
                  </Text>
                </Text>
                <PrBadge
                  pr={row.pr}
                  sidebarWidth={sidebarWidth}
                  author={row.pr.createdByDisplayName || 'unknown'}
                />
              </Box>
            );
          })}
          {belowLines > 0 && (
            <Text dimColor>↓ {belowLines / LINES_PER_ROW} more</Text>
          )}
        </>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          <Text color="cyan">j/k</Text> navigate
        </Text>
        <Text dimColor>
          <Text color="cyan">d</Text> view diff
        </Text>
        <Text dimColor>
          <Text color="cyan">enter</Text> review with Claude
        </Text>
        <Text dimColor>
          <Text color="cyan">esc</Text> back to sidebar
        </Text>
        <Text dimColor>
          <Text color="cyan">1</Text> sessions tab
        </Text>
        <Text dimColor>
          <Text color="cyan">r</Text> refresh
        </Text>
        <Text dimColor>
          <Text color="cyan">q</Text> quit
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>🔔 needs attention ⭐ fully approved</Text>
      </Box>
    </Box>
  );
});
