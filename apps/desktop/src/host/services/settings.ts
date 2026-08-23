import { readConfig } from '@kirby/vcs-core';
import {
  buildSettingsFields,
  persistConfigField,
  resolveValue,
  updateConfigField,
} from '@kirby/app-core';
import { PROVIDERS, requireRepo } from './repo.js';
import type { SettingsFieldView } from '../contract.js';

function activeFields() {
  const config = readConfig(requireRepo());
  const provider = config.vendor
    ? PROVIDERS.find((p) => p.id === config.vendor) ?? null
    : null;
  // The Controls row opens the TUI keybinding panel — desktop has its
  // own UX for that later, so it isn't part of the form model.
  return {
    config,
    provider,
    fields: buildSettingsFields(provider).filter((f) => !f.action),
  };
}

/**
 * Build the settings form model for the active repo: every editable
 * field (same catalog the CLI's settings panel uses) with its current
 * resolved display value.
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
  const updated = updateConfigField(config, field, value);
  persistConfigField(field, value, updated);
}
