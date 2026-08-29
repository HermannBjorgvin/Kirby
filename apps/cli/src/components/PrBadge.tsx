import { memo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { truncate } from '@kirby/core';
import { prBadgeModel } from './pr-badge-model.js';

export const PrBadge = memo(function PrBadge({
  pr,
  sidebarWidth,
  author,
}: {
  pr: PullRequestInfo | null | undefined;
  sidebarWidth: number;
  author?: string;
}) {
  if (pr == null) {
    return <Text dimColor>{'  (no PR)'}</Text>;
  }

  const badge = prBadgeModel(pr, sidebarWidth);

  return (
    <Box flexDirection="column" width={badge.innerWidth}>
      <Box height={1}>
        <Text>
          <Text dimColor>{'  '}</Text>
          <Text color="blue">{badge.idText}</Text>
          {badge.reviewText ? (
            <Text color={badge.reviewColor}>{`  ${badge.reviewText}`}</Text>
          ) : null}
          {badge.commentText ? (
            <Text color="yellow">{`  ${badge.commentText}`}</Text>
          ) : null}
        </Text>
        {badge.trailing ? (
          <Box flexGrow={1} justifyContent="flex-end">
            <Text>{badge.trailing}</Text>
          </Box>
        ) : null}
      </Box>
      {author ? (
        <Box>
          <Text dimColor>
            {'  '}by {truncate(author, badge.innerWidth - 5)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
