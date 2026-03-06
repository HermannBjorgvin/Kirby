import { memo } from 'react';
import { Text, Box } from 'ink';
import type { CategorizedReviews, PullRequestInfo } from '@kirby/vcs-core';
import { PrBadge } from './PrBadge.js';
import { truncate } from '../utils/truncate.js';

function ReviewSection({
  title,
  titleColor,
  prs,
  selectedPrId,
  sidebarWidth,
}: {
  title: string;
  titleColor: string;
  prs: PullRequestInfo[];
  selectedPrId: number | undefined;
  sidebarWidth: number;
}) {
  const innerWidth = Math.max(10, sidebarWidth - 2);
  if (prs.length === 0) return null;
  return (
    <>
      <Box marginTop={1}>
        <Text bold color={titleColor}>
          {title} ({prs.length})
        </Text>
      </Box>
      <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      {prs.map((pr) => {
        const selected = pr.id === selectedPrId;
        return (
          <Box key={pr.id} flexDirection="column">
            <Text>
              <Text color={selected ? 'cyan' : undefined}>
                {selected ? '› ' : '  '}
              </Text>
              <Text bold={selected}>
                {truncate(pr.title || pr.sourceBranch, innerWidth - 4)}
              </Text>
            </Text>
            <PrBadge pr={pr} sidebarWidth={sidebarWidth} />
            <Text dimColor>
              {'  '}by {pr.createdByDisplayName || 'unknown'}
            </Text>
          </Box>
        );
      })}
    </>
  );
}

export const ReviewsSidebar = memo(function ReviewsSidebar({
  categorized,
  selectedPrId,
  sidebarWidth,
  focused = true,
}: {
  categorized: CategorizedReviews;
  selectedPrId: number | undefined;
  sidebarWidth: number;
  focused?: boolean;
}) {
  const innerWidth = Math.max(10, sidebarWidth - 2);
  const totalItems =
    categorized.needsReview.length +
    categorized.waitingForAuthor.length +
    categorized.approvedByYou.length;

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
          <ReviewSection
            title="Needs Your Review"
            titleColor="red"
            prs={categorized.needsReview}
            selectedPrId={selectedPrId}
            sidebarWidth={sidebarWidth}
          />
          <ReviewSection
            title="Waiting for Author"
            titleColor="yellow"
            prs={categorized.waitingForAuthor}
            selectedPrId={selectedPrId}
            sidebarWidth={sidebarWidth}
          />
          <ReviewSection
            title="Approved by You"
            titleColor="green"
            prs={categorized.approvedByYou}
            selectedPrId={selectedPrId}
            sidebarWidth={sidebarWidth}
          />
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
