import { readConfig, type AppConfig } from '@kirby/vcs-core';
import { persistConfigField, updateConfigField } from '@kirby/app-core';
import {
  applySessionBackend,
  buildSettingsFields,
  getTmuxAvailability,
  hasAnySession,
  projectTerminalBackendOverride,
  resolveValue,
  settingsEffects,
  type SettingsEffect,
  type SettingsField,
} from '@kirby/core';
import { PROVIDERS, requireRepo } from './repo.js';
import { onCredentialsChanged } from './sidebar.js';
import { startRemoteSyncLoop } from './remote-sync.js';
import { SECRET_PLACEHOLDER } from '../contract.js';
import type { SettingsFieldView, SettingsGroup } from '../contract.js';

/**
 * Fields that only make sense for the terminal UI (keyboard focus
 * model, Ink layout toggles). The desktop has its own affordances for
 * these, so they are hidden from the desktop settings page.
 */
const TUI_ONLY_KEYS = new Set([
  'keybindPreset',
  'autoHideSidebar',
  'jumpToInactiveOnEscape',
  'diffFileListTree',
]);

const GROUP_BY_KEY: Record<string, SettingsGroup> = {
  agentId: 'agent',
  editor: 'general',
  email: 'general',
  worktreePath: 'general',
  terminalBackend: 'terminal',
  autoDeleteOnMerge: 'sync',
  autoRebase: 'sync',
  mergePollInterval: 'sync',
};

function groupFor(field: SettingsField): SettingsGroup {
  if (field.configBag === 'vendorAuth' || field.configBag === 'vendorProject') {
    return 'provider';
  }
  return GROUP_BY_KEY[field.key] ?? 'general';
}

function kindFor(field: SettingsField): SettingsFieldView['kind'] {
  const presets = field.presets;
  if (!presets || presets.length === 0) return 'text';
  const values = presets.map((p) => p.value).sort();
  if (values.length === 2 && values[0] === 'false' && values[1] === 'true') {
    return 'boolean';
  }
  return 'select';
}

function activeFields() {
  const config = readConfig(requireRepo());
  const provider = config.vendor
    ? PROVIDERS.find((p) => p.id === config.vendor) ?? null
    : null;
  return {
    config,
    provider,
    fields: buildSettingsFields(provider).filter(
      (f) => !f.action && !TUI_ONLY_KEYS.has(f.key)
    ),
  };
}

/**
 * Build the settings form model for the active repo: every editable
 * field (same catalog the CLI's settings panel uses, minus TUI-only
 * toggles) with its current resolved display value plus the section
 * and widget kind the desktop page should render it with.
 */
export function getSettingsView(): SettingsFieldView[] {
  const { config, fields } = activeFields();
  return fields.map((field) => ({
    label: field.label,
    key: field.key,
    masked: field.masked,
    description: field.description,
    presets: field.presets?.map((preset) => ({ ...preset })),
    defaultValue: field.defaultValue,
    // Secrets (provider PAT / token) are never sent to the renderer.
    // It renders PR-authored markdown and provider-hosted images, so
    // anything it holds is one script-execution foothold away from
    // being read. A stored secret is represented by a placeholder the
    // write path treats as "unchanged"; replacing it still works.
    value: field.masked
      ? resolveValue(config, field)
        ? SECRET_PLACEHOLDER
        : ''
      : resolveValue(config, field),
    group: groupFor(field),
    kind: kindFor(field),
    // Same gate updateSettingsFromView enforces — surfacing it here
    // grays the control out instead of erroring after the attempt.
    disabled:
      field.key === 'terminalBackend' ? backendDisabledReason() : undefined,
  }));
}

/** Why the terminal backend control is not editable right now, or
 *  undefined when it is. Surfaced on the field so the control is grayed
 *  out with a reason rather than erroring after the click. */
function backendDisabledReason(): string | undefined {
  if (hasAnySession()) {
    return 'close all sessions to switch the terminal backend';
  }
  if (projectTerminalBackendOverride(requireRepo())) {
    return 'this project pins the terminal backend in its own config';
  }
  return undefined;
}

/**
 * The same guards as the TUI's `canApplyFieldChange`: never swap the
 * terminal backend out from under live sessions, and refuse tmux when
 * the binary is missing — surfacing the install hint now rather than a
 * spawn failure at the next launch.
 */
function assertBackendSwitchAllowed(value: string): void {
  if (hasAnySession()) {
    throw new Error('Close all sessions before switching terminal backend.');
  }
  // Writing the global key while the project config overrides it would
  // save, then revert on the next read.
  if (projectTerminalBackendOverride(requireRepo())) {
    throw new Error(
      'This project pins terminalBackend in its own config — edit that instead.'
    );
  }
  if (value !== 'tmux') return;
  const status = getTmuxAvailability();
  if (status && !status.available) {
    const hint = status.installHint ? ` — try \`${status.installHint}\`` : '';
    throw new Error(`tmux not installed${hint}`);
  }
}

/**
 * Persist one settings edit. The field is looked up from the host's
 * own catalog by label+key — the client never dictates which config
 * bag a value lands in.
 */
export function updateSettingsFromView(
  ref: { label: string; key: string },
  value: string
): void {
  requireRepo(); // settings always operate on the active repo
  const { config, fields } = activeFields();
  const field = fields.find((f) => f.label === ref.label && f.key === ref.key);
  if (!field) throw new Error(`Unknown settings field: ${ref.label}`);
  // The renderer only ever saw a placeholder for a stored secret, so
  // getting it back means the field wasn't edited — writing it would
  // overwrite the real credential with dots.
  if (field.masked && value === SECRET_PLACEHOLDER) return;
  if (field.key === 'terminalBackend') assertBackendSwitchAllowed(value);
  // The TUI persists a cleared field as undefined (`editBuffer ||
  // undefined`) so project-level values fall back to global instead
  // of shadowing it with '' (or 0 for numeric keys).
  const normalized = value === '' ? undefined : value;
  const updated = updateConfigField(config, field, normalized);
  persistConfigField(field, normalized, updated);
  runSettingsEffects(settingsEffects(field), updated);
}

/**
 * Carry out what the write implies. Which effects a field has is
 * `@kirby/core`'s call (settings/effects.ts) and is shared with the
 * TUI; only the doing is the host's.
 */
function runSettingsEffects(
  effects: SettingsEffect[],
  updated: AppConfig
): void {
  for (const effect of effects) {
    switch (effect) {
      case 'apply-session-backend':
        applySessionBackend(updated);
        break;
      case 'reset-provider-cache':
        // Every provider, not just the selected one: on a `vendor`
        // change the stale entries belong to the provider being left,
        // and switching back within its TTL would serve answers
        // fetched under the old configuration.
        for (const provider of PROVIDERS) provider.resetCaches?.();
        break;
      case 'refresh-remote':
        onCredentialsChanged();
        break;
      case 'restart-sync-loop':
        startRemoteSyncLoop(requireRepo());
        break;
    }
  }
}
