/**
 * Deciding whether a settings edit is worth writing.
 *
 * A settings row saves on blur as well as on Enter, so leaving a field
 * alone must not be a write. The obvious test — "does it differ from
 * the value the query reports?" — is wrong: that value only catches up
 * when the settings query refetches, so an edit made in the window
 * right after a save looks unchanged and vanishes.
 *
 * So a save is remembered until the query speaks again. The moment it
 * does — reporting our own write, or somebody else's — the query is
 * authoritative and the record is spent. What the record must *not* do
 * is outlive that: Kirby's config has two front ends, and once the
 * query has reported our B a second writer can put the old A back.
 * Matching on the value alone cannot tell that A from the A the save
 * was made against, so the row would go on offering B and republish it
 * over the other writer.
 *
 * The record is therefore stamped with the query's `dataUpdatedAt` and
 * consulted only while that stamp still stands (the value it was made
 * against has to match too, which settles two fetches landing inside
 * the same millisecond). Retiring it early costs at worst one redundant
 * write of the value the user already has typed; holding it too long
 * loses somebody's edit, so the bias runs this way deliberately.
 */

/**
 * A save made locally: what was written, and the state of the settings
 * query it was written against.
 */
export interface PendingSave {
  /** The query's `dataUpdatedAt` when the save went out. */
  seenAt: number;
  /** The value the query reported then. */
  base: string;
  /** What was written. */
  value: string;
}

/**
 * What the field is believed to hold on disk right now.
 *
 * Invariant: a pending save is consulted only while the settings query
 * has produced no result since that save was issued. Once it has, the
 * query wins — whatever value it carries, and whether or not that value
 * happens to equal the one the save was made against.
 */
export function persistedValue(
  serverValue: string,
  serverUpdatedAt: number,
  pending: PendingSave | null
): string {
  if (!pending) return serverValue;
  const querySpokeSince =
    pending.seenAt !== serverUpdatedAt || pending.base !== serverValue;
  return querySpokeSince ? serverValue : pending.value;
}
