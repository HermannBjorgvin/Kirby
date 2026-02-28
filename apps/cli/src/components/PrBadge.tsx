import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/shared-types';

export function PrBadge({
  pr,
  url,
  sidebarWidth,
}: {
  pr: PullRequestInfo | null | undefined;
  url?: string;
  sidebarWidth: number;
}) {
  if (pr == null) {
    return <Text dimColor>{'  (no PR)'}</Text>;
  }

  const approvedCount = pr.reviewers.filter((r) => r.vote >= 5).length;
  const totalReviewers = pr.reviewers.length;
  const hasRejected = pr.reviewers.some((r) => r.vote === -10);
  const hasWaiting = pr.reviewers.some((r) => r.vote === -5);

  let reviewColor: string;
  if (hasRejected) {
    reviewColor = 'red';
  } else if (hasWaiting) {
    reviewColor = 'yellow';
  } else if (totalReviewers > 0 && approvedCount === totalReviewers) {
    reviewColor = 'green';
  } else {
    reviewColor = 'gray';
  }

  const reviewText =
    totalReviewers > 0 ? `${approvedCount}/${totalReviewers} approved` : '';

  const needsAttention = pr.activeCommentCount > 0 || hasWaiting;

  let statusEmoji = '';
  if (reviewColor === 'green' && !needsAttention) {
    statusEmoji = '⭐';
  } else if (needsAttention && !pr.isDraft) {
    statusEmoji = '🔔';
  }

  let buildEmoji = '';
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
  }

  const innerWidth = Math.max(10, sidebarWidth - 2);

  return (
    <Box width={innerWidth}>
      <Text>
        <Text dimColor>{'  '}</Text>
        <Text color="blue">
          {url
            ? `\x1b]8;;${url}\x07#${pr.pullRequestId}\x1b]8;;\x07`
            : `#${pr.pullRequestId}`}
        </Text>
        {reviewText ? (
          <Text color={reviewColor}>{`  ${reviewText}`}</Text>
        ) : null}
        {pr.activeCommentCount > 0 ? (
          <Text color="yellow">{`  ${pr.activeCommentCount} comment${
            pr.activeCommentCount !== 1 ? 's' : ''
          }`}</Text>
        ) : null}
      </Text>
      {statusEmoji || buildEmoji ? (
        <Box flexGrow={1} justifyContent="flex-end">
          <Text>
            {buildEmoji}
            {statusEmoji}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
