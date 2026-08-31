import type { SettingsField } from '@kirby/core';

/**
 * The value column for one settings row. A field with presets shows
 * the matching preset's name, or marks a hand-typed value as custom,
 * or names the default it falls back to; a masked field shows stars;
 * anything else shows itself.
 *
 * The default is the field's own `defaultValue` when it has one —
 * `terminalBackend` resolves its default from the tmux probe at read
 * time, so the row must name *that* backend rather than the first
 * preset, or a machine with tmux would read "PTY (default)" while
 * running tmux. Fields without one keep the first-preset meaning.
 */
export function displayValueFor(
  field: SettingsField,
  rawValue: string
): string {
  if (field.presets) {
    const matched = field.presets.find((p) => p.value === rawValue);
    if (matched) return matched.name;
    if (rawValue) return `Custom: ${rawValue}`;
    const fallback =
      field.presets.find((p) => p.value === field.defaultValue) ??
      field.presets[0];
    return fallback ? `${fallback.name} (default)` : '(not set)';
  }
  if (field.masked && rawValue.length > 0) {
    return '*'.repeat(Math.min(rawValue.length, 20));
  }
  return rawValue || '(not set)';
}
