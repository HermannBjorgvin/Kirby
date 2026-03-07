import { memo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';

export const ReviewDetailPane = memo(function ReviewDetailPane({
  pr,
}: {
  pr: PullRequestInfo | undefined;
}) {
  if (!pr) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text dimColor>(select a PR to see details)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>{pr.title || pr.sourceBranch}</Text>
      <Text dimColor>
        #{pr.id} · {pr.sourceBranch} → {pr.targetBranch}
      </Text>
      <Text dimColor>
        by {pr.createdByDisplayName || 'unknown'} · {pr.activeCommentCount ?? 0}{' '}
        comments · {(pr.reviewers ?? []).length} reviewers
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          press <Text color="cyan">d</Text> to view diff ·{' '}
          <Text color="cyan">enter</Text> to review with Claude
        </Text>
      </Box>
    </Box>
  );
});
