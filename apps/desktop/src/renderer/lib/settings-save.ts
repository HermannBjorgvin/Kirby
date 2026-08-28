/**
 * Deciding whether a settings edit is worth writing.
 *
 * A settings row saves on blur as well as on Enter, so leaving a field
 * alone must not be a write. The obvious test — "does it differ from
 * the value the query reports?" — is wrong: that value only catches up
 * when the settings query refetches, so an edit made in the window
 * right after a save looks unchanged and vanishes.
 *
 * So a save is remembered together with the server value it was made
 * against. While that value still stands, the write we just made is the
 * newer truth; the moment it moves — the refetch landed, or something
 * else wrote the field — the record is stale and the server value wins
 * again.
 */

/** A save made locally, and the server value it was made against. */
export interface PendingSave {
  base: string;
  value: string;
}

/** What the field is believed to hold on disk right now. */
export function persistedValue(
  serverValue: string,
  pending: PendingSave | null
): string {
  return pending && pending.base === serverValue ? pending.value : serverValue;
}
