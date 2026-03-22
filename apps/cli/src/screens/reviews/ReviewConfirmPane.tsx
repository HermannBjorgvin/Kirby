import { memo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';

function Option({ label, selected }: { label: string; selected: boolean }) {
  return (
    <Text>
      <Text color={selected ? 'cyan' : undefined}>
        {selected ? '› ' : '  '}
      </Text>
      <Text bold={selected}>{label}</Text>
    </Text>
  );
}

export const ReviewConfirmPane = memo(function ReviewConfirmPane({
  pr,
  selectedOption,
  instruction,
}: {
  pr: PullRequestInfo;
  selectedOption: number;
  instruction: string;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>PR #{pr.id}</Text>
      <Text bold>{pr.title || pr.sourceBranch}</Text>
      <Text dimColor>
        {pr.sourceBranch} → {pr.targetBranch} · by{' '}
        {pr.createdByDisplayName || 'unknown'}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text>What would you like to do?</Text>

        <Box marginTop={1} flexDirection="column">
          <Option label="Start session" selected={selectedOption === 0} />
          <Option label="Start review" selected={selectedOption === 1} />

          <Box flexDirection="column">
            <Option label="Add instructions:" selected={selectedOption === 2} />
            {selectedOption === 2 && (
              <Text>
                {'    '}
                <Text color="cyan">&gt; {instruction}</Text>
                <Text dimColor>_</Text>
              </Text>
            )}
          </Box>

          <Option label="Cancel" selected={selectedOption === 3} />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {selectedOption === 2
            ? 'type to add instructions · enter start · esc cancel'
            : 'j/k navigate · enter select · esc cancel'}
        </Text>
      </Box>
    </Box>
  );
});
