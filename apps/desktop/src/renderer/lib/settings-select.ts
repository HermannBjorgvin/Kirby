import type { SettingsFieldView } from '../../host/contract.js';

/** Sentinel value for the select's "Custom…" entry, which is not a
 *  preset but an escape hatch into a free-text box. */
export const CUSTOM = '__custom__';

/**
 * Which entry a preset select shows for a field.
 *
 * A stored value names its own preset, or reads as custom. An unset
 * field shows the default the host named — the terminal backend
 * resolves its default from the tmux probe, so a machine with tmux
 * would otherwise report PTY while running tmux — and only falls back
 * to the first concrete preset for the fields that name no default.
 */
export function selectedPreset(field: SettingsFieldView): string {
  const presets = field.presets ?? [];
  if (field.value !== '') {
    return presets.some((p) => p.value === field.value) ? field.value : CUSTOM;
  }
  return (
    presets.find((p) => p.value === field.defaultValue)?.value ??
    presets.find((p) => p.value !== null)?.value ??
    ''
  );
}

/**
 * Whether this preset is the one the row falls back to because nothing
 * is stored — the only case that earns a "(default)" marker.
 *
 * Only a host-supplied `defaultValue` counts. The first preset is a
 * rendering convention rather than a resolved default, and marking it
 * would claim things that are not true: an unset Editor does not mean
 * VS Code, it means the `EDITOR`/`VISUAL` fallback.
 */
export function isDefaultedPreset(
  field: SettingsFieldView,
  presetValue: string | null
): boolean {
  if (field.value !== '' || field.defaultValue === undefined) return false;
  return presetValue === field.defaultValue;
}
