import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPrDetails,
  dueForRefresh,
  forgetPrDetails,
  forgetRepoDetails,
  isPendingVerdict,
  lastKnownComments,
  lastKnownStatus,
  prDetailMemo,
  pruneRepoDetails,
  rememberPrDetails,
  reusableComments,
  reusableStatus,
  type PrDetailTtls,
} from './pr-details.js';

/**
 * When a cycle is allowed to answer from what it already knows.
 *
 * The cost of getting this wrong is asymmetric, which is why the rules
 * are pessimistic: reusing too little spends requests, reusing too much
 * shows the user a badge that is simply wrong and that nothing will
 * come along and correct.
 */

const TTLS: PrDetailTtls = { statusMs: 10_000, commentsMs: 3_000 };
const REPO = 'org/project/repo';

beforeEach(() => clearPrDetails());

/** Remember a full read at `at`, and return the memo. */
function remembered(mergeKey: string | undefined, at = 0) {
  rememberPrDetails(REPO, 1, {
    mergeKey,
    now: at,
    status: 'succeeded',
    statusRead: true,
    comments: 3,
  });
  return prDetailMemo(REPO, 1);
}

describe('reusableStatus', () => {
  it('answers for a pull request that has not moved', () => {
    expect(reusableStatus(remembered('abc'), 'abc', 5_000, TTLS)).toBe(
      'succeeded'
    );
  });

  it('declines once the merge identity has moved', () => {
    // A push means new CI against a new tree; nothing remembered stands.
    expect(reusableStatus(remembered('abc'), 'def', 1, TTLS)).toBeNull();
  });

  it('declines when there is no merge identity to compare', () => {
    // Two rows that both report nothing are not the same row unchanged.
    expect(reusableStatus(remembered(undefined), undefined, 1, TTLS)).toBeNull();
    expect(reusableStatus(remembered(''), '', 1, TTLS)).toBeNull();
  });

  it('declines while the checks are still running', () => {
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 0, status: 'pending' });
    // The one moment the badge is worth watching.
    expect(reusableStatus(prDetailMemo(REPO, 1), 'abc', 1, TTLS)).toBeNull();
    expect(isPendingVerdict(prDetailMemo(REPO, 1))).toBe(true);
  });

  it('declines once its life has run out', () => {
    expect(reusableStatus(remembered('abc'), 'abc', 10_000, TTLS)).toBeNull();
  });

  it('answers "no CI here" as readily as a verdict', () => {
    // A repository that posts no statuses at all is the case that
    // benefits most: `none` is settled, and asking again never changes
    // it.
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 0, status: 'none' });
    expect(reusableStatus(prDetailMemo(REPO, 1), 'abc', 1, TTLS)).toBe('none');
  });

  it('has nothing to say about a pull request it has never seen', () => {
    expect(reusableStatus(undefined, 'abc', 1, TTLS)).toBeNull();
  });
});

describe('reusableComments', () => {
  it('answers inside its own, shorter life', () => {
    expect(reusableComments(remembered('abc'), 2_999, TTLS)).toBe(3);
  });

  it('expires before a settled status does', () => {
    const memo = remembered('abc');
    expect(reusableComments(memo, 3_000, TTLS)).toBeNull();
    // Comments come round more often; a settled verdict outlives them.
    expect(reusableStatus(memo, 'abc', 3_000, TTLS)).toBe('succeeded');
  });

  it('survives a push, which changes nothing about it', () => {
    // Tying the count to the commit would throw a perfectly good answer
    // away every time an agent committed.
    remembered('abc');
    rememberPrDetails(REPO, 1, { mergeKey: 'def', now: 1, status: 'pending' });
    expect(reusableComments(prDetailMemo(REPO, 1), 2, TTLS)).toBe(3);
  });

  it('distinguishes a remembered zero from nothing remembered', () => {
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 0, comments: 0 });
    expect(reusableComments(prDetailMemo(REPO, 1), 1, TTLS)).toBe(0);
  });
});

describe('dueForRefresh', () => {
  const due = (
    rows: [number, number | null, boolean?][],
    budget: number
  ): number[] =>
    [
      ...dueForRefresh(
        rows.map(([prId, readAt, urgent]) => ({ prId, readAt, urgent })),
        budget
      ),
    ].sort((a, b) => a - b);

  it('spends the budget on the oldest rows', () => {
    expect(
      due(
        [
          [1, 500],
          [2, 100],
          [3, 300],
        ],
        2
      )
    ).toEqual([2, 3]);
  });

  it('puts something never read at the front', () => {
    expect(
      due(
        [
          [1, 0],
          [2, null],
        ],
        1
      )
    ).toEqual([2]);
  });

  it('lets a row with checks in flight jump the queue', () => {
    // Read a moment ago, so by age it would sort last — and it is the
    // one row whose badge is actually moving.
    expect(
      due(
        [
          [1, 0],
          [2, 0],
          [3, 999, true],
        ],
        1
      )
    ).toEqual([3]);
  });

  it('still takes turns among the rows in flight', () => {
    // Otherwise a hundred running builds would be served lowest-id
    // first, forever.
    expect(
      due(
        [
          [1, 900, true],
          [2, 100, true],
        ],
        1
      )
    ).toEqual([2]);
  });

  it('breaks ties on the pull request id rather than on map order', () => {
    expect(
      due(
        [
          [7, 100],
          [3, 100],
        ],
        1
      )
    ).toEqual([3]);
  });

  it('takes everything when the budget is larger than the queue', () => {
    expect(
      due(
        [
          [1, 1],
          [2, 2],
        ],
        25
      )
    ).toEqual([1, 2]);
  });

  it('spends nothing on a budget of zero', () => {
    expect(due([[1, 1]], 0)).toEqual([]);
  });
});

describe('the store', () => {
  it('keeps the half a cycle did not read at its own age', () => {
    remembered('abc', 0);
    // A cycle that reused the status and re-read the count must not
    // make the status look fresh again — or a settled verdict would
    // live forever, refreshed by its neighbour.
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 9_000, comments: 4 });
    const memo = prDetailMemo(REPO, 1);
    expect(reusableComments(memo, 9_001, TTLS)).toBe(4);
    expect(reusableStatus(memo, 'abc', 10_001, TTLS)).toBeNull();
  });

  it('keeps the old verdict on hand after a push, without reusing it', () => {
    // A row the budget cannot reach still has to show something, and
    // the previous colour beats "no CI" — but it must not be served as
    // if it were about the new commit.
    remembered('abc', 0);
    rememberPrDetails(REPO, 1, { mergeKey: 'def', now: 1 });
    const memo = prDetailMemo(REPO, 1);
    expect(reusableStatus(memo, 'def', 2, TTLS)).toBeNull();
    expect(lastKnownStatus(memo)).toBe('succeeded');
  });

  it('records that a read happened even when it established nothing', () => {
    // Ordering is by when a row was last read, not by how old its
    // answer is. A read that produced no verdict must still send the
    // row to the back, or the same rows are picked forever.
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 7, statusRead: true });
    expect(prDetailMemo(REPO, 1)?.statusReadAt).toBe(7);
    expect(lastKnownStatus(prDetailMemo(REPO, 1))).toBeUndefined();
  });

  it('leaves the read time alone on a cycle that did not read', () => {
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 7, statusRead: true });
    rememberPrDetails(REPO, 1, { mergeKey: 'abc', now: 99, comments: 1 });
    expect(prDetailMemo(REPO, 1)?.statusReadAt).toBe(7);
  });

  it('keeps the last count on hand however old it is', () => {
    remembered('abc', 0);
    // Past its life: not reusable, but still the best thing to show
    // while the budget goes to rows that have waited longer.
    expect(reusableComments(prDetailMemo(REPO, 1), 99_999, TTLS)).toBeNull();
    expect(lastKnownComments(prDetailMemo(REPO, 1))).toBe(3);
  });

  it('keeps two repositories apart', () => {
    // Azure numbers pull requests per project, and the desktop keeps
    // several repositories' sidebars alive at once.
    remembered('abc', 0);
    rememberPrDetails('other/project/repo', 1, {
      mergeKey: 'abc',
      now: 0,
      status: 'failed',
    });
    expect(reusableStatus(prDetailMemo(REPO, 1), 'abc', 1, TTLS)).toBe(
      'succeeded'
    );
    expect(
      reusableStatus(prDetailMemo('other/project/repo', 1), 'abc', 1, TTLS)
    ).toBe('failed');
  });

  it('forgets one pull request without forgetting its neighbours', () => {
    remembered('abc', 0);
    rememberPrDetails(REPO, 2, { mergeKey: 'xyz', now: 0, status: 'failed' });
    forgetPrDetails(REPO, 1);
    expect(prDetailMemo(REPO, 1)).toBeUndefined();
    expect(reusableStatus(prDetailMemo(REPO, 2), 'xyz', 1, TTLS)).toBe('failed');
  });
});

describe('forgetRepoDetails', () => {
  it('marks a repository due without blanking what it shows', () => {
    // Deleting would grey out every badge the cycle's budget cannot
    // reach — on two hundred rows, refresh would blank most of them.
    remembered('abc', 0);
    forgetRepoDetails(REPO);
    const memo = prDetailMemo(REPO, 1);
    expect(reusableStatus(memo, 'abc', 1, TTLS)).toBeNull();
    expect(reusableComments(memo, 1, TTLS)).toBeNull();
    expect(lastKnownStatus(memo)).toBe('succeeded');
    expect(lastKnownComments(memo)).toBe(3);
  });

  it('puts the refreshed rows at the front of the queue', () => {
    remembered('abc', 0);
    forgetRepoDetails(REPO);
    expect(prDetailMemo(REPO, 1)?.statusReadAt).toBeNull();
  });

  it('leaves another repository alone', () => {
    remembered('abc', 0);
    rememberPrDetails('org/project/repo2', 9, {
      mergeKey: 'abc',
      now: 0,
      status: 'failed',
    });
    forgetRepoDetails(REPO);
    // The `#` separator is what stops `repo` matching `repo2`.
    expect(
      reusableStatus(prDetailMemo('org/project/repo2', 9), 'abc', 1, TTLS)
    ).toBe('failed');
  });
});

describe('pruneRepoDetails', () => {
  it('drops rows the repository no longer has open', () => {
    remembered('abc', 0);
    rememberPrDetails(REPO, 2, { mergeKey: 'xyz', now: 0, status: 'failed' });
    pruneRepoDetails(REPO, [1]);
    expect(prDetailMemo(REPO, 1)).toBeDefined();
    expect(prDetailMemo(REPO, 2)).toBeUndefined();
  });

  it('leaves another repository’s rows alone', () => {
    rememberPrDetails('org/project/repo2', 2, { mergeKey: 'x', now: 0 });
    pruneRepoDetails(REPO, []);
    expect(prDetailMemo('org/project/repo2', 2)).toBeDefined();
  });
});
