import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/shared-types';

export function ReviewDetailPane({ pr }: { pr: PullRequestInfo | undefined }) {
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
        #{pr.pullRequestId} · {pr.sourceBranch} → {pr.targetBranch}
      </Text>
      <Text dimColor>
        by {pr.createdByDisplayName ?? 'unknown'} · {pr.activeCommentCount}{' '}
        comments · {pr.reviewers.length} reviewers
      </Text>
      <Box marginTop={1}>
        <Text dimColor>(detail view coming soon)</Text>
      </Box>
    </Box>
  );
}
