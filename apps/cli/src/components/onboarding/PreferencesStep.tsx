import { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import type { AppConfig } from '@kirby/vcs-core';
import { useConfig } from '../../context/ConfigContext.js';
import { BOOL_PRESETS, resolveValue } from '../SettingsPanel.js';
import type { SettingsField } from '../SettingsPanel.js';

interface PrefItem {
  field: SettingsField;
  description: string;
}

export const PREF_ITEMS: PrefItem[] = [
  {
    field: {
      label: 'Auto Delete on Merge',
      key: 'autoDeleteOnMerge',
      presets: BOOL_PRESETS,
      configBag: 'global',
    },
    description: 'Remove merged worktree branches automatically',
  },
  {
    field: {
      label: 'Auto Rebase',
      key: 'autoRebase',
      presets: BOOL_PRESETS,
      configBag: 'global',
    },
    description: 'Rebase worktree branches onto master after sync',
  },
];

interface PreferencesStepProps {
  config: AppConfig;
  isActive: boolean;
  onAdvance: () => void;
  onSkip: () => void;
}

export function PreferencesStep({
  config,
  isActive,
  onAdvance,
  onSkip,
}: PreferencesStepProps) {
  const { updateField } = useConfig();
  const [prefIndex, setPrefIndex] = useState(0);

  useInput(
    (input, key) => {
      if (key.escape) return onSkip();
      if (input === 'j' || key.downArrow) {
        setPrefIndex((i) => Math.min(i + 1, PREF_ITEMS.length - 1));
        return;
      }
      if (input === 'k' || key.upArrow) {
        setPrefIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (key.return || key.leftArrow || key.rightArrow) {
        const pref = PREF_ITEMS[prefIndex]!;
        const currentValue = resolveValue(config, pref.field) || 'false';
        const toggled = currentValue === 'true' ? 'false' : 'true';
        updateField(pref.field, toggled);
        if (key.return && prefIndex === PREF_ITEMS.length - 1) {
          onAdvance();
          return;
        }
        return;
      }
      if (key.tab) return onAdvance();
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        Preferences
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      <Text> </Text>
      {PREF_ITEMS.map((pref, i) => {
        const isCurrent = i === prefIndex;
        const value = resolveValue(config, pref.field);
        const isOn = value === 'true';
        return (
          <Box key={pref.field.key} flexDirection="column">
            <Text>
              <Text color={isCurrent ? 'cyan' : undefined}>
                {isCurrent ? '› ' : '  '}
              </Text>
              <Text bold={isCurrent}>{pref.field.label}: </Text>
              <Text color={isOn ? 'green' : undefined}>
                {isOn ? 'On' : 'Off'}
              </Text>
            </Text>
            {isCurrent ? <Text dimColor> {pref.description}</Text> : null}
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>
        j/k nav · Enter or ←/→ toggle · Tab next step · Esc skip
      </Text>
    </Box>
  );
}
