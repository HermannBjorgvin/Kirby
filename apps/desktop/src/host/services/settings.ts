import { readConfig } from '@kirby/vcs-core';
import {
  applySessionBackend,
  buildSettingsFields,
  getTmuxAvailability,
  hasAnySession,
  persistConfigField,
  resolveValue,
  updateConfigField,
  type SettingsField,
} from '@kirby/app-core';
import { PROVIDERS, requireRepo } from './repo.js';
import { startRemoteSyncLoop } from './remote-sync.js';
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
    value: resolveValue(config, field),
    group: groupFor(field),
    kind: kindFor(field),
  }));
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
  // Same guards as the TUI's canApplyFieldChange: never swap the
  // terminal backend under live sessions, and refuse tmux when the
  // binary is missing (surfacing the install hint now instead of a
  // spawn failure later).
  if (field.key === 'terminalBackend') {
    if (hasAnySession()) {
      throw new Error('Close all sessions before switching terminal backend.');
    }
    if (value === 'tmux') {
      const status = getTmuxAvailability();
      if (status && !status.available) {
        const hint = status.installHint
          ? ` — try \`${status.installHint}\``
          : '';
        throw new Error(`tmux not installed${hint}`);
      }
    }
  }
  // The TUI persists a cleared field as undefined (`editBuffer ||
  // undefined`) so project-level values fall back to global instead
  // of shadowing it with '' (or 0 for numeric keys).
  const normalized = value === '' ? undefined : value;
  const updated = updateConfigField(config, field, normalized);
  persistConfigField(field, normalized, updated);
  if (field.key === 'terminalBackend') {
    applySessionBackend(updated);
  }
  // The sync loop's cadence comes from config; restart it so a new
  // interval takes effect now instead of after the old timer fires.
  if (field.key === 'mergePollInterval') {
    startRemoteSyncLoop(requireRepo());
  }
}
