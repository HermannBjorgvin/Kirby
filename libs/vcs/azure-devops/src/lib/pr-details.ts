import type { BuildStatusState } from '@kirby/vcs-core';

/**
 * What a sync cycle already knows about a pull request, so it does not
 * have to ask again.
 *
 * Azure has no batch endpoint for either a pull request's status list
 * or its comment threads, so a cycle costs **two requests per open
 * pull request** — every minute, for every row, whether or not anything
 * about that row has moved. On a repository with a hundred open pull
 * requests that is a couple of hundred requests a minute, and Azure
 * throttles per organization: the client spends its budget re-reading
 * answers it already has and then gets refused.
 *
 * The cheap observation is that most of those answers cannot have
 * changed. A pull request's CI verdict is a function of its head
 * commit, so while `lastMergeSourceCommit` is where we left it, a
 * settled verdict is still the verdict.
 *
 * Comment counts are not a function of the commit — anyone can comment
 * at any time, and pushing changes nothing about them — so they cannot
 * be pinned to one and get a plain age instead.
 *
 * Neither half may arrive as a burst. Rows read together expire
 * together, so a plain TTL turns one quiet cycle into a request per row
 * on the next one — and a sliding-window rate limit cares about exactly
 * that shape. Each cycle therefore spends a **budget** on the oldest
 * rows of each kind, and shows the last answer it had for the rest.
 * That is what bounds a cycle: a repository with five hundred open pull
 * requests costs a cycle no more than one with fifty, and takes more
 * cycles to come round instead.
 *
 * What is remembered is the **combined** verdict — the status list and
 * the pipeline runs reduced to one answer — because that is what the
 * row displays and both halves are a function of the same commit.
 * Knowing it also means the cycle has no one to ask the runs listing
 * on behalf of, so that request goes too and a quiet cycle costs one
 * request in total.
 *
 * Two things are deliberately *not* remembered:
 *
 *   • A `pending` verdict. CI in flight is the one moment the user is
 *     actually watching the badge, and it is also a tiny fraction of
 *     the rows.
 *   • A verdict the cycle could not actually establish. The runs
 *     listing is capped and can leave a row unaccounted for; recording
 *     the status list on its own would show a red pipeline as green
 *     until the memo ran out. An unknown stays unknown and is asked
 *     about again.
 */

export interface PrDetailTtls {
  /** A settled verdict on an unchanged commit. Only a re-run moves it,
   *  which is the staleness this trades for not being throttled. */
  statusMs: number;
  /** How old a comment count may get before it is due again. */
  commentsMs: number;
}

export const PR_DETAIL_TTL: PrDetailTtls = {
  statusMs: 10 * 60_000,
  commentsMs: 3 * 60_000,
};

/**
 * Rows of each kind one cycle may read. A repository with fewer open
 * pull requests than this behaves exactly as it did before the budget
 * existed; a larger one comes round in several cycles rather than
 * spending a request per row at once.
 */
export const REFRESH_BUDGET = 25;

interface Stamped<T> {
  value: T;
  at: number;
}

/** A verdict, and the merge identity it was a verdict *about*. */
interface StampedStatus extends Stamped<BuildStatusState> {
  mergeKey: string | undefined;
}

/**
 * An age so old nothing is fresh at it, used to mark a row due without
 * throwing away what it last said. `0` would not do: a test clock — or
 * a machine that has just booted — can be a few milliseconds past it.
 */
const LONG_AGO = Number.NEGATIVE_INFINITY;

export interface PrDetailMemo {
  /**
   * The verdict, and when it was read. Kept across a push rather than
   * dropped: `reusableStatus` will not serve it once the merge identity
   * moves, but a row the budget did not reach still has to show
   * *something*, and last week's colour beats "no CI".
   */
  status: StampedStatus | null;
  /**
   * When the status was last *read*, whether or not the read produced
   * anything worth keeping. Ordering uses this rather than `status.at`:
   * a read that answered nothing must still send its row to the back of
   * the queue, or the same rows are picked forever and the rest are
   * never read at all.
   */
  statusReadAt: number | null;
  comments: Stamped<number> | null;
}

/** The value, if it was read recently enough to still stand. */

/** The value, if it was read recently enough to still stand. */
function stillGood<T>(
  stamped: Stamped<T> | null,
  now: number,
  ttlMs: number
): T | null {
  if (stamped === null || now - stamped.at >= ttlMs) return null;
  return stamped.value;
}

/**
 * The remembered CI verdict, or null when it has to be read again.
 *
 * An unknown merge identity is never reusable: without one there is no
 * way to tell a pull request that has not moved from one that has, and
 * guessing wrong means a badge nothing will correct.
 */
export function reusableStatus(
  memo: PrDetailMemo | undefined,
  mergeKey: string | undefined,
  now: number,
  ttls: PrDetailTtls = PR_DETAIL_TTL
): BuildStatusState | null {
  // An empty key is what a pull request with no merge commit reduces to
  // on the way through, and it is not an identity — two rows that both
  // report nothing are not therefore the same row unchanged.
  if (memo?.status == null || !mergeKey) return null;
  if (memo.status.mergeKey !== mergeKey) return null;
  const status = stillGood(memo.status, now, ttls.statusMs);
  // A check still running is the one thing worth asking about again.
  return status === 'pending' ? null : status;
}

/** Whether the last verdict said the checks were still running. */
export function isPendingVerdict(memo: PrDetailMemo | undefined): boolean {
  return memo?.status?.value === 'pending';
}

/**
 * The remembered comment count, or null when it is due again.
 *
 * No head commit here, deliberately: a push does not change what people
 * have said, so tying the count to the commit would throw away a
 * perfectly good answer every time an agent committed.
 */
export function reusableComments(
  memo: PrDetailMemo | undefined,
  now: number,
  ttls: PrDetailTtls = PR_DETAIL_TTL
): number | null {
  if (memo === undefined) return null;
  return stillGood(memo.comments, now, ttls.commentsMs);
}

/** The count last read, however old — better on screen than nothing. */
export function lastKnownComments(
  memo: PrDetailMemo | undefined
): number | undefined {
  return memo?.comments?.value;
}

/** The verdict last read, however old, and whatever commit it was for. */
export function lastKnownStatus(
  memo: PrDetailMemo | undefined
): BuildStatusState | undefined {
  return memo?.status?.value;
}

/**
 * Which of the pull requests that are due may actually be read this
 * cycle: the oldest first, up to `budget`. Something never read at all
 * is the oldest there is.
 *
 * Ties break on the pull request id so a cycle is not at the mercy of
 * map ordering — two rows read in the same millisecond must not be able
 * to take turns starving each other.
 */
export function dueForRefresh(
  candidates: readonly {
    prId: number;
    readAt: number | null;
    /** Worth reading ahead of anything settled — checks in flight. */
    urgent?: boolean;
  }[],
  budget: number
): Set<number> {
  const ordered = [...candidates].sort((a, b) => {
    // Urgency first, then age. Within the urgent rows age still decides,
    // so a hundred running builds still take turns rather than the
    // lowest ids winning every cycle.
    if (Boolean(a.urgent) !== Boolean(b.urgent)) return a.urgent ? -1 : 1;
    if (a.readAt !== b.readAt) return (a.readAt ?? -Infinity) - (b.readAt ?? -Infinity);
    return a.prId - b.prId;
  });
  return new Set(ordered.slice(0, Math.max(0, budget)).map((c) => c.prId));
}

// ── The store ───────────────────────────────────────────────────────
//
// Keyed by repository as well as pull request id: two Azure projects
// number their pull requests independently, and the desktop now keeps
// several repositories' sidebars alive at once.

const memos = new Map<string, PrDetailMemo>();

function memoKey(repoKey: string, prId: number): string {
  return `${repoKey}#${prId}`;
}

export function prDetailMemo(
  repoKey: string,
  prId: number
): PrDetailMemo | undefined {
  return memos.get(memoKey(repoKey, prId));
}

/**
 * Record what a cycle read. Only the halves it actually read are
 * stamped — the other keeps the timestamp it already had, so reusing a
 * status does not make its comment count look fresh.
 */
export function rememberPrDetails(
  repoKey: string,
  prId: number,
  read: {
    /** The merge identity the verdict is about. */
    mergeKey?: string;
    /** A verdict worth keeping. Absent when the cycle established none. */
    status?: BuildStatusState;
    /** The cycle spent a request on the status, whatever came back. */
    statusRead?: boolean;
    comments?: number;
    now: number;
  }
): void {
  const key = memoKey(repoKey, prId);
  const previous = memos.get(key);
  memos.set(key, {
    // Both halves survive a read that produced nothing, and survive a
    // push: what makes a verdict unusable is its merge key no longer
    // matching, which `reusableStatus` checks, not its absence here.
    status:
      read.status === undefined
        ? (previous?.status ?? null)
        : { value: read.status, at: read.now, mergeKey: read.mergeKey },
    statusReadAt: read.statusRead ? read.now : (previous?.statusReadAt ?? null),
    comments:
      read.comments === undefined
        ? (previous?.comments ?? null)
        : { value: read.comments, at: read.now },
  });
}

/** Forget one pull request — called after a write against it. */
export function forgetPrDetails(repoKey: string, prId: number): void {
  memos.delete(memoKey(repoKey, prId));
}

/**
 * Forget one repository's rows — what an explicit refresh means.
 *
 * A settled verdict is remembered for ten minutes, which is right for
 * a poll and wrong for a button: a user who presses refresh is telling
 * us they think something has changed, and answering from memory makes
 * the button look broken.
 */
export function forgetRepoDetails(repoKey: string): void {
  for (const [key, memo] of memos) {
    if (!key.startsWith(`${repoKey}#`)) continue;
    // Marked due, not deleted. Deleting would blank every badge the
    // cycle's budget cannot reach — on a repository with two hundred
    // rows, pressing refresh would grey out a hundred and seventy-five
    // of them for several minutes, which is worse than what it fixes.
    memos.set(key, {
      status: memo.status === null ? null : { ...memo.status, at: LONG_AGO },
      statusReadAt: null,
      comments:
        memo.comments === null ? null : { ...memo.comments, at: LONG_AGO },
    });
  }
}

/**
 * Drop rows this repository no longer has open, so a long session does
 * not accumulate an entry for every pull request it has ever seen.
 */
export function pruneRepoDetails(repoKey: string, keep: Iterable<number>): void {
  const live = new Set([...keep].map((prId) => memoKey(repoKey, prId)));
  for (const key of [...memos.keys()]) {
    if (key.startsWith(`${repoKey}#`) && !live.has(key)) memos.delete(key);
  }
}

/** Forget everything. Called when the credentials or project change. */
export function clearPrDetails(): void {
  memos.clear();
}
