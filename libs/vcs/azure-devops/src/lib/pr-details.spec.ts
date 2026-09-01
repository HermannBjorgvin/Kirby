import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearPrDetails,
  forgetPrDetails,
  prDetailMemo,
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
function remembered(headSha: string | undefined, at = 0) {
  rememberPrDetails(REPO, 1, {
    headSha,
    now: at,
    status: 'succeeded',
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

  it('declines once the head commit has moved', () => {
    // A push means new CI against a new tree; nothing remembered stands.
    expect(reusableStatus(remembered('abc'), 'def', 1, TTLS)).toBeNull();
  });

  it('declines when there is no head commit to compare', () => {
    // Two rows that both report nothing are not the same row unchanged.
    expect(reusableStatus(remembered(undefined), undefined, 1, TTLS)).toBeNull();
    expect(reusableStatus(remembered(''), '', 1, TTLS)).toBeNull();
  });

  it('declines while the checks are still running', () => {
    rememberPrDetails(REPO, 1, { headSha: 'abc', now: 0, status: 'pending' });
    // The one moment the badge is worth watching.
    expect(reusableStatus(prDetailMemo(REPO, 1), 'abc', 1, TTLS)).toBeNull();
  });

  it('declines once its life has run out', () => {
    expect(reusableStatus(remembered('abc'), 'abc', 10_000, TTLS)).toBeNull();
  });

  it('answers "no CI here" as readily as a verdict', () => {
    // A repository that posts no statuses at all is the case that
    // benefits most: `none` is settled, and asking again never changes
    // it.
    rememberPrDetails(REPO, 1, { headSha: 'abc', now: 0, status: 'none' });
    expect(reusableStatus(prDetailMemo(REPO, 1), 'abc', 1, TTLS)).toBe('none');
  });

  it('has nothing to say about a pull request it has never seen', () => {
    expect(reusableStatus(undefined, 'abc', 1, TTLS)).toBeNull();
  });
});

describe('reusableComments', () => {
  it('answers inside its own, shorter life', () => {
    expect(reusableComments(remembered('abc'), 'abc', 2_999, TTLS)).toBe(3);
  });

  it('expires before a settled status does', () => {
    const memo = remembered('abc');
    expect(reusableComments(memo, 'abc', 3_000, TTLS)).toBeNull();
    // Comments move without a push; a settled verdict does not.
    expect(reusableStatus(memo, 'abc', 3_000, TTLS)).toBe('succeeded');
  });

  it('distinguishes a remembered zero from nothing remembered', () => {
    rememberPrDetails(REPO, 1, { headSha: 'abc', now: 0, comments: 0 });
    expect(reusableComments(prDetailMemo(REPO, 1), 'abc', 1, TTLS)).toBe(0);
  });
});

describe('the store', () => {
  it('keeps the half a cycle did not read at its own age', () => {
    remembered('abc', 0);
    // A cycle that reused the status and re-read the count must not
    // make the status look fresh again — or a settled verdict would
    // live forever, refreshed by its neighbour.
    rememberPrDetails(REPO, 1, { headSha: 'abc', now: 9_000, comments: 4 });
    const memo = prDetailMemo(REPO, 1);
    expect(reusableComments(memo, 'abc', 9_001, TTLS)).toBe(4);
    expect(reusableStatus(memo, 'abc', 10_001, TTLS)).toBeNull();
  });

  it('drops both halves when the commit changes under it', () => {
    remembered('abc', 0);
    rememberPrDetails(REPO, 1, { headSha: 'def', now: 1, comments: 9 });
    const memo = prDetailMemo(REPO, 1);
    expect(reusableComments(memo, 'def', 2, TTLS)).toBe(9);
    // The old commit's verdict must not survive the push.
    expect(reusableStatus(memo, 'def', 2, TTLS)).toBeNull();
  });

  it('keeps two repositories apart', () => {
    // Azure numbers pull requests per project, and the desktop keeps
    // several repositories' sidebars alive at once.
    remembered('abc', 0);
    rememberPrDetails('other/project/repo', 1, {
      headSha: 'abc',
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
    rememberPrDetails(REPO, 2, { headSha: 'xyz', now: 0, status: 'failed' });
    forgetPrDetails(REPO, 1);
    expect(prDetailMemo(REPO, 1)).toBeUndefined();
    expect(reusableStatus(prDetailMemo(REPO, 2), 'xyz', 1, TTLS)).toBe('failed');
  });
});
