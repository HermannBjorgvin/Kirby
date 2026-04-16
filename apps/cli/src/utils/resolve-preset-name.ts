/**
 * Resolve a config value to a human-readable preset name.
 *
 * Matches `value` against the presets array (same shape as SettingsPanel
 * presets). Returns the matched preset's `name`, or `fallback` for
 * unrecognized custom values. When `value` is undefined/empty, returns
 * the first preset's name (the default).
 */
export function resolvePresetName(
  value: string | undefined,
  presets: readonly { name: string; value: string | null }[],
  fallback: string
): string {
  if (!value) return presets[0]?.name ?? fallback;
  const matched = presets.find((p) => p.value === value);
  if (matched) return matched.name;
  return fallback;
}
