import { useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import {
  useConfig,
  useKeybindResolve,
  useKeybinds,
  useSettingsState,
  useSettingsActions,
  useSessionActions,
} from '@kirby/app-core';
import { buildSettingsFields, resolveValue } from '@kirby/core';
import { handleSettingsInput } from '../input-handlers.js';

function SettingsHints({ enterAction }: { enterAction: 'toggle' | 'edit' }) {
  const kb = useKeybindResolve();
  const navKeys = kb.getNavKeys('settings');
  const editKeys = kb.getHintKeys('settings.edit-toggle');
  const autoDetectKeys = kb.getHintKeys('settings.auto-detect');
  const closeKeys = kb.getHintKeys('settings.close');

  return (
    <Box marginTop={1}>
      <Text dimColor>
        <Text color="cyan">{navKeys}</Text> nav ·{' '}
        <Text color="cyan">{editKeys}</Text> {enterAction} ·{' '}
        <Text color="cyan">{autoDetectKeys}</Text> auto-detect ·{' '}
        <Text color="cyan">{closeKeys}</Text> back
      </Text>
    </Box>
  );
}

export function SettingsPanel({
  fieldIndex,
  editingField,
  editBuffer,
}: {
  fieldIndex: number;
  editingField: string | null;
  editBuffer: string;
}) {
  const configCtx = useConfig();
  const { config, provider } = configCtx;
  const fields = useMemo(() => buildSettingsFields(provider), [provider]);

  // ── Input routing ──────────────────────────────────────────────
  // SettingsPanel owns its keypress routing; MainTab no longer has
  // to branch on settingsOpen. Guard against the controls sub-screen
  // so both panels don't double-handle when ControlsPanel is up.
  const settingsState = useSettingsState();
  const settingsActions = useSettingsActions();
  const settings = useMemo(
    () => ({ ...settingsState, ...settingsActions }),
    [settingsState, settingsActions]
  );
  const sessions = useSessionActions();
  // handleSettingsInput uses both resolve() and setPreset(), so we
  // subscribe to the combined Keybind context.
  const keybinds = useKeybinds();

  useInput(
    (input, key) => {
      handleSettingsInput(input, key, {
        settings,
        config: configCtx,
        sessions,
        keybinds,
      });
    },
    { isActive: settings.settingsOpen && !settings.controlsOpen }
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold color="magenta">
        Settings
        {provider ? <Text dimColor> ({provider.displayName})</Text> : null}
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      {fields.map((field, i) => {
        const selected = i === fieldIndex;
        const isEditing = editingField === field.key;
        const rawValue = resolveValue(config, field);

        let displayValue: string;
        if (field.presets) {
          const matched = field.presets.find((p) => p.value === rawValue);
          if (matched) {
            displayValue = matched.name;
          } else if (rawValue) {
            displayValue = `Custom: ${rawValue}`;
          } else {
            const defaultPreset = field.presets[0];
            displayValue = defaultPreset
              ? defaultPreset.name + ' (default)'
              : '(not set)';
          }
        } else if (field.masked && rawValue.length > 0) {
          displayValue = '*'.repeat(Math.min(rawValue.length, 20));
        } else {
          displayValue = rawValue || '(not set)';
        }

        return (
          <Box key={field.key} flexDirection="column">
            <Text>
              <Text color={selected ? 'cyan' : undefined}>
                {selected ? '› ' : '  '}
              </Text>
              <Text bold={selected}>{field.label}: </Text>
              {isEditing ? (
                <Text color="cyan">
                  {editBuffer}
                  <Text dimColor>_</Text>
                </Text>
              ) : (
                <Text dimColor={!rawValue && !field.presets}>
                  {displayValue}
                </Text>
              )}
              {selected && field.presets && !isEditing ? (
                <Text dimColor>
                  {field.presets.every((p) => p.value !== null)
                    ? ' ←/→ or Enter to toggle'
                    : ' ←/→ preset · Enter custom'}
                </Text>
              ) : null}
            </Text>
            {selected && field.description ? (
              <Text dimColor> {field.description}</Text>
            ) : null}
          </Box>
        );
      })}
      {!provider ? (
        <Box marginTop={1}>
          <Text dimColor>
            Connect to GitHub or Azure DevOps to enable PR tracking,
            auto-rebase, and auto-delete.
          </Text>
        </Box>
      ) : null}
      <SettingsHints
        enterAction={
          fields[fieldIndex]?.presets?.every((p) => p.value !== null)
            ? 'toggle'
            : 'edit'
        }
      />
    </Box>
  );
}
