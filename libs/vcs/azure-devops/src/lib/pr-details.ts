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
 * settled verdict is still the verdict. Comment counts are not tied to
 * the commit — anyone can comment at any time — so they get their own,
 * shorter life.
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
  /** Comment counts move without a push, so this one is shorter. */
  commentsMs: number;
}

export const PR_DETAIL_TTL: PrDetailTtls = {
  statusMs: 10 * 60_000,
  commentsMs: 3 * 60_000,
};

interface Stamped<T> {
  value: T;
  at: number;
}

export interface PrDetailMemo {
  /** `lastMergeSourceCommit` when these were read. */
  headSha: string | undefined;
  status: Stamped<BuildStatusState> | null;
  comments: Stamped<number> | null;
}

/**
 * Whether a memo still speaks for this pull request.
 *
 * An unknown head commit is never reusable: without one there is no way
 * to tell a pull request that has not moved from one that has, and
 * guessing wrong means a stale badge that nothing will correct.
 */
function sameCommit(
  memo: PrDetailMemo | undefined,
  headSha: string | undefined
): memo is PrDetailMemo {
  // An empty string is what a missing `lastMergeSourceCommit` reduces
  // to on the way through, and it is not a commit — two rows that both
  // report nothing are not therefore the same row unchanged.
  if (memo === undefined || !headSha) return false;
  return memo.headSha === headSha;
}

/** The value, if it was read recently enough to still stand. */
function stillGood<T>(
  stamped: Stamped<T> | null,
  now: number,
  ttlMs: number
): T | null {
  if (stamped === null || now - stamped.at >= ttlMs) return null;
  return stamped.value;
}

/** The remembered CI verdict, or null when it has to be read again. */
export function reusableStatus(
  memo: PrDetailMemo | undefined,
  headSha: string | undefined,
  now: number,
  ttls: PrDetailTtls = PR_DETAIL_TTL
): BuildStatusState | null {
  if (!sameCommit(memo, headSha)) return null;
  const status = stillGood(memo.status, now, ttls.statusMs);
  // A check still running is the one thing worth asking about again.
  return status === 'pending' ? null : status;
}

/** The remembered comment count, or null when it has to be read again. */
export function reusableComments(
  memo: PrDetailMemo | undefined,
  headSha: string | undefined,
  now: number,
  ttls: PrDetailTtls = PR_DETAIL_TTL
): number | null {
  if (!sameCommit(memo, headSha)) return null;
  return stillGood(memo.comments, now, ttls.commentsMs);
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
    headSha: string | undefined;
    status?: BuildStatusState;
    comments?: number;
    now: number;
  }
): void {
  const key = memoKey(repoKey, prId);
  const previous = memos.get(key);
  const carried =
    previous && previous.headSha === read.headSha
      ? previous
      : { headSha: read.headSha, status: null, comments: null };
  memos.set(key, {
    headSha: read.headSha,
    status:
      read.status === undefined
        ? carried.status
        : { value: read.status, at: read.now },
    comments:
      read.comments === undefined
        ? carried.comments
        : { value: read.comments, at: read.now },
  });
}

/** Forget one pull request — called after a write against it. */
export function forgetPrDetails(repoKey: string, prId: number): void {
  memos.delete(memoKey(repoKey, prId));
}

/** Forget everything. Called when the credentials or project change. */
export function clearPrDetails(): void {
  memos.clear();
}
