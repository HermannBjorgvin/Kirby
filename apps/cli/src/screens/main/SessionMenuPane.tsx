import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { useConfig } from '../../context/ConfigContext.js';
import { buildAgentOptions } from '../../agents/agent-options.js';
import { sessionMenuOptions } from './session-menu-input.js';

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

export const SessionMenuPane = memo(function SessionMenuPane({
  pr,
  sessionName,
  selectedOption,
  agentIndex,
  instruction,
}: {
  pr: PullRequestInfo | null;
  sessionName: string | null;
  selectedOption: number;
  agentIndex: number;
  instruction: string;
}) {
  const config = useConfig();
  const agentOptions = useMemo(
    () => buildAgentOptions(config.config),
    [config.config]
  );
  const safeAgentIdx = Math.min(
    Math.max(agentIndex, 0),
    agentOptions.length - 1
  );
  const agentName = agentOptions[safeAgentIdx]?.name ?? 'Agent';

  const options = sessionMenuOptions(pr != null);
  const opt = Math.min(selectedOption, options.length - 1);
  const optKey = options[opt]!;
  const startSelected = optKey === 'start';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {pr ? (
        <>
          <Text bold>PR #{pr.id}</Text>
          <Text bold>{pr.title || pr.sourceBranch}</Text>
          <Text dimColor>
            {pr.sourceBranch} → {pr.targetBranch} · by{' '}
            {pr.createdByDisplayName || 'unknown'}
          </Text>
        </>
      ) : (
        <Text bold>{sessionName ?? 'Session'}</Text>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text>What would you like to do?</Text>

        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text color={startSelected ? 'cyan' : undefined}>
              {startSelected ? '› ' : '  '}
            </Text>
            <Text bold={startSelected}>Start/Continue session</Text>
            <Text dimColor> · agent: </Text>
            <Text color="cyan">{agentName}</Text>
          </Text>

          {pr && (
            <>
              <Option
                label="Start/Continue review"
                selected={optKey === 'review'}
              />
              <Box flexDirection="column">
                <Option
                  label="Add instructions:"
                  selected={optKey === 'instructions'}
                />
                {optKey === 'instructions' && (
                  <Text>
                    {'    '}
                    <Text color="cyan">&gt; {instruction}</Text>
                    <Text dimColor>_</Text>
                  </Text>
                )}
              </Box>
            </>
          )}

          <Option label="Cancel" selected={optKey === 'cancel'} />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {optKey === 'instructions'
            ? 'type to add instructions · enter start · esc cancel'
            : startSelected
            ? 'j/k navigate · ←/→ agent · enter select · esc cancel'
            : 'j/k navigate · enter select · esc cancel'}
        </Text>
      </Box>
    </Box>
  );
});
