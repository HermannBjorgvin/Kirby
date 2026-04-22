import { memo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { truncate } from '../utils/truncate.js';

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

  const reviewers = pr.reviewers ?? [];
  const approvedCount = reviewers.filter(
    (r) => r.decision === 'approved'
  ).length;
  const totalReviewers = reviewers.length;
  const hasRejected = reviewers.some((r) => r.decision === 'changes-requested');

  let reviewColor: string;
  if (hasRejected) {
    reviewColor = 'red';
  } else if (totalReviewers > 0 && approvedCount === totalReviewers) {
    reviewColor = 'green';
  } else {
    reviewColor = 'gray';
  }

  const reviewText =
    totalReviewers > 0 ? `${approvedCount}/${totalReviewers} approved` : '';

  const activeComments = pr.activeCommentCount ?? 0;
  const needsAttention = activeComments > 0 || hasRejected;

  let statusEmoji = '';
  if (reviewColor === 'green' && !needsAttention) {
    statusEmoji = '⭐';
  } else if (needsAttention && !pr.isDraft) {
    statusEmoji = '🔔';
  }

  let buildEmoji = '';
  if (pr.buildStatus) {
    switch (pr.buildStatus) {
      case 'failed':
        buildEmoji = '🔥';
        break;
      case 'succeeded':
        buildEmoji = '✅';
        break;
      case 'pending':
        buildEmoji = '⏳';
        break;
      case 'none':
        break;
    }
  }

  const innerWidth = Math.max(10, sidebarWidth - 2);

  return (
    <Box flexDirection="column" width={innerWidth}>
      <Box height={1}>
        <Text>
          <Text dimColor>{'  '}</Text>
          <Text color="blue">
            {pr.url
              ? `\x1b]8;;${pr.url}\x07#${pr.id}\x1b]8;;\x07`
              : `#${pr.id}`}
          </Text>
          {reviewText ? (
            <Text color={reviewColor}>{`  ${reviewText}`}</Text>
          ) : null}
          {activeComments > 0 ? (
            <Text color="yellow">{`  ${activeComments} comment${
              activeComments !== 1 ? 's' : ''
            }`}</Text>
          ) : null}
        </Text>
        {statusEmoji || buildEmoji ? (
          <Box flexGrow={1} justifyContent="flex-end">
            <Text>
              {buildEmoji ? `🔧${buildEmoji}` : ''}
              {buildEmoji && statusEmoji ? ' ' : ''}
              {statusEmoji}
            </Text>
          </Box>
        ) : null}
      </Box>
      {author ? (
        <Box>
          <Text dimColor>
            {'  '}by {truncate(author, innerWidth - 5)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
});
