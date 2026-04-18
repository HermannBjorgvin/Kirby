import { useMemo } from 'react';
import { Text, Box, useInput } from 'ink';
import type { AppConfig, VcsProvider } from '@kirby/vcs-core';
import { useConfig } from '../context/ConfigContext.js';
import { useKeybindResolve, useKeybinds } from '../context/KeybindContext.js';
import {
  useSettingsState,
  useSettingsActions,
} from '../context/ModalContext.js';
import { useSessionActions } from '../context/SessionContext.js';
import { handleSettingsInput } from '../input-handlers.js';

export interface SettingsField {
  label: string;
  key: string;
  masked?: boolean;
  description?: string;
  presets?: { name: string; value: string | null }[];
  /** Which config bag this field lives in */
  configBag: 'global' | 'project' | 'vendorAuth' | 'vendorProject';
  /** If set, Enter on this field triggers a named action instead of editing */
  action?: 'open-controls';
}

export const AI_PRESETS: { name: string; value: string | null }[] = [
  { name: 'Claude', value: 'claude --continue || claude' },
  { name: 'Codex', value: 'codex' },
  { name: 'Gemini', value: 'gemini' },
  { name: 'Copilot', value: 'gh copilot' },
  { name: 'Custom', value: null },
];

export const BOOL_PRESETS: { name: string; value: string | null }[] = [
  { name: 'Off', value: 'false' },
  { name: 'On', value: 'true' },
];

export const BOOL_PRESETS_ON_FIRST: { name: string; value: string | null }[] = [
  { name: 'On', value: 'true' },
  { name: 'Off', value: 'false' },
];

export const EDITOR_PRESETS: { name: string; value: string | null }[] = [
  { name: 'VS Code', value: 'code' },
  { name: 'VS Code Insiders', value: 'code-insiders' },
  { name: 'Sublime Text', value: 'subl' },
  { name: 'Custom', value: null },
];

export const SYNC_INTERVAL_PRESETS: { name: string; value: string | null }[] = [
  { name: '1 hour', value: '3600000' },
  { name: '5 min', value: '300000' },
  { name: '15 min', value: '900000' },
  { name: '30 min', value: '1800000' },
  { name: 'Custom', value: null },
];

export const KEYBIND_PRESETS: { name: string; value: string | null }[] = [
  { name: 'Normie defaults', value: 'normie' },
  { name: 'Vim Losers', value: 'vim' },
];

/** Build the settings field list dynamically from the active provider */
export function buildSettingsFields(
  provider: VcsProvider | null
): SettingsField[] {
  const fields: SettingsField[] = [
    {
      label: 'Controls',
      key: 'keybindPreset',
      description: 'Keybinding preset — Enter to view all bindings',
      presets: KEYBIND_PRESETS,
      configBag: 'global',
      action: 'open-controls',
    },
    {
      label: 'AI Tool',
      key: 'aiCommand',
      presets: AI_PRESETS,
      configBag: 'global',
    },
    {
      label: 'Editor',
      key: 'editor',
      presets: EDITOR_PRESETS,
      configBag: 'global',
    },
    {
      label: 'Editor (project)',
      key: 'editor',
      description:
        'Override editor for this project (leave empty to inherit global)',
      presets: EDITOR_PRESETS,
      configBag: 'project',
    },
    { label: 'Email', key: 'email', configBag: 'project' },
    {
      label: 'Worktree Path',
      key: 'worktreePath',
      description:
        'Template for worktree placement ({session} = sanitized branch). Restart required.',
      configBag: 'global',
    },
    {
      label: 'Auto Hide Sidebar',
      key: 'autoHideSidebar',
      description:
        'Hide the sidebar when focused on a terminal session or diff',
      presets: BOOL_PRESETS_ON_FIRST,
      configBag: 'global',
    },
  ];

  if (provider) {
    fields.push(
      {
        label: 'Auto Delete on Merge',
        key: 'autoDeleteOnMerge',
        description: 'Remove merged worktree branches automatically',
        presets: BOOL_PRESETS,
        configBag: 'global',
      },
      {
        label: 'Auto Rebase',
        key: 'autoRebase',
        description: 'Rebase worktree branches onto master after sync',
        presets: BOOL_PRESETS,
        configBag: 'global',
      },
      {
        label: 'Sync Interval',
        key: 'mergePollInterval',
        description: 'How often to check for merged PRs and conflicts',
        presets: SYNC_INTERVAL_PRESETS,
        configBag: 'global',
      }
    );
    for (const f of provider.authFields) {
      fields.push({
        label: f.label,
        key: f.key,
        masked: f.masked,
        configBag: 'vendorAuth',
      });
    }
    for (const f of provider.projectFields) {
      fields.push({
        label: f.label,
        key: f.key,
        configBag: 'vendorProject',
      });
    }
  }

  return fields;
}

/** Resolve the display value from config for a settings field */
export function resolveValue(config: AppConfig, field: SettingsField): string {
  switch (field.configBag) {
    case 'global':
    case 'project':
      return String(
        (config as unknown as Record<string, unknown>)[field.key] ?? ''
      );
    case 'vendorAuth':
      return String(config.vendorAuth[field.key] ?? '');
    case 'vendorProject':
      return String(config.vendorProject[field.key] ?? '');
  }
}

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
