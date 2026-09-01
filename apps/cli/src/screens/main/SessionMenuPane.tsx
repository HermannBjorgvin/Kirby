import { memo, useMemo } from 'react';
import { Text, Box } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { useConfig, useKeybindResolve } from '@kirby/app-core';
import type { KeybindResolveValue } from '@kirby/app-core';
import {
  buildAgentOptions,
  keyDescriptorToString,
  sessionMenuOptions,
  type SessionMenuOptionKey,
} from '@kirby/core';

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

function PrHeader({ pr }: { pr: PullRequestInfo }) {
  return (
    <>
      <Text bold>PR #{pr.id}</Text>
      <Text bold>{pr.title || pr.sourceBranch}</Text>
      <Text dimColor>
        {pr.sourceBranch} → {pr.targetBranch} · by{' '}
        {pr.createdByDisplayName || 'unknown'}
      </Text>
    </>
  );
}

/** The review rows, shown only for items backed by a pull request. */
function ReviewRows({
  optKey,
  instruction,
}: {
  optKey: SessionMenuOptionKey;
  instruction: string;
}) {
  return (
    <>
      <Option label="Start/Continue review" selected={optKey === 'review'} />
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
  );
}

/** Primary key of an action under the active preset. */
function primaryKey(kb: KeybindResolveValue, actionId: string): string {
  const desc = kb.bindings[actionId]?.[0];
  return desc ? keyDescriptorToString(desc) : '?';
}

/** The hint line per row, spelled with the active preset's keys. */
function buildHints(
  kb: KeybindResolveValue
): Record<SessionMenuOptionKey, string> {
  const nav = `${kb.getNavKeys('confirm')} navigate`;
  const agent = `${primaryKey(kb, 'confirm.cycle-agent-left')}/${primaryKey(
    kb,
    'confirm.cycle-agent-right'
  )} agent`;
  const rest = 'enter select · esc cancel';
  return {
    start: `${nav} · ${agent} · ${rest}`,
    review: `${nav} · ${rest}`,
    instructions: 'type to add instructions · enter start · esc cancel',
    cancel: `${nav} · ${rest}`,
  };
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
  const keybinds = useKeybindResolve();
  const hints = useMemo(() => buildHints(keybinds), [keybinds]);
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
  const optKey = options[Math.min(selectedOption, options.length - 1)]!;
  const startSelected = optKey === 'start';

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {pr ? <PrHeader pr={pr} /> : <Text bold>{sessionName ?? 'Session'}</Text>}

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

          {pr && <ReviewRows optKey={optKey} instruction={instruction} />}

          <Option label="Cancel" selected={optKey === 'cancel'} />
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{hints[optKey]}</Text>
      </Box>
    </Box>
  );
});
