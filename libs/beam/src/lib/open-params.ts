/**
 * Small shared guards for reading a stream's JSON open parameters
 * (docs/beam.md's `pty`/`exec` open payloads), used by both handlers.
 */

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function isStringRecord(
  value: unknown
): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isString)
  );
}
