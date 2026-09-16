import type { SettingsField } from '@kirby/core';

/**
 * The value column for one settings row. A field with presets shows
 * the matching preset's name, or marks a hand-typed value as custom,
 * or names the default it falls back to; a masked field shows stars;
 * anything else shows itself.
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
