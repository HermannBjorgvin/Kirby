import { describe, it, expect } from 'vitest';
import type {
  BuildStatusState,
  PullRequestInfo,
  ReviewDecision,
} from '@kirby/vcs-core';
import {
  buildEmoji,
  prBadgeModel,
  reviewColor,
  statusEmoji,
} from './pr-badge-model.js';

function reviewers(...decisions: ReviewDecision[]) {
  return decisions.map((decision, i) => ({
    identifier: `r${i}`,
    displayName: `r${i}`,
    decision,
  }));
}

function pullRequest(over: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    title: 'Add a thing',
    sourceBranch: 'feature',
    targetBranch: 'main',
    url: 'https://example.com/pr/42',
    createdByIdentifier: 'u1',
    createdByDisplayName: 'User One',
    ...over,
  };
}

describe('reviewColor', () => {
  it('is gray when nobody has been asked to review', () => {
    expect(reviewColor([])).toBe('gray');
    expect(reviewColor(undefined)).toBe('gray');
  });

  it('is gray while some reviewers have not responded', () => {
    expect(reviewColor(reviewers('approved', 'no-response'))).toBe('gray');
  });

  it('is green only when every reviewer approved', () => {
    expect(reviewColor(reviewers('approved', 'approved'))).toBe('green');
  });

  it('does not treat a declined review as an approval or as blocking', () => {
    // `declined` is "not my call" — it neither completes the set nor
    // holds the request up, so the badge stays neutral.
    expect(reviewColor(reviewers('approved', 'declined'))).toBe('gray');
  });

  it('is yellow for a blocking vote', () => {
    expect(reviewColor(reviewers('changes-requested'))).toBe('yellow');
    expect(reviewColor(reviewers('waiting-for-author'))).toBe('yellow');
  });

  it('is red for a rejection, whatever else is present', () => {
    expect(reviewColor(reviewers('approved', 'rejected'))).toBe('red');
    expect(reviewColor(reviewers('changes-requested', 'rejected'))).toBe('red');
  });
});

describe('buildEmoji', () => {
  const cases: [BuildStatusState | undefined, string][] = [
    ['failed', '🔥'],
    ['succeeded', '✅'],
    ['pending', '⏳'],
    ['none', ''],
    [undefined, ''],
  ];
  it.each(cases)('%s → %s', (status, expected) => {
    expect(buildEmoji(status)).toBe(expected);
  });
});

describe('statusEmoji', () => {
  it('stars a fully approved request with nothing outstanding', () => {
    expect(
      statusEmoji({ color: 'green', needsAttention: false, isDraft: false })
    ).toBe('⭐');
  });

  it('drops the star as soon as something is outstanding', () => {
    expect(
      statusEmoji({ color: 'green', needsAttention: true, isDraft: false })
    ).toBe('🔔');
  });

  it('rings for an unapproved request with something outstanding', () => {
    expect(
      statusEmoji({ color: 'yellow', needsAttention: true, isDraft: false })
    ).toBe('🔔');
  });

  it('stays silent on a draft even with something outstanding', () => {
    expect(
      statusEmoji({ color: 'yellow', needsAttention: true, isDraft: true })
    ).toBe('');
  });

  it('still stars an approved draft with nothing outstanding', () => {
    // Draft only suppresses the bell — the star is not a demand on the
    // author, so it survives.
    expect(
      statusEmoji({ color: 'green', needsAttention: false, isDraft: true })
    ).toBe('⭐');
  });

  it('shows nothing for a quiet, unapproved request', () => {
    expect(
      statusEmoji({ color: 'gray', needsAttention: false, isDraft: false })
    ).toBe('');
  });
});

describe('prBadgeModel — attention', () => {
  it('treats an open comment as something outstanding', () => {
    const pr = pullRequest({
      reviewers: reviewers('approved'),
      activeCommentCount: 1,
    });
    expect(prBadgeModel(pr, 40).trailing).toBe('🔔');
  });

  it('treats a blocking vote as something outstanding without comments', () => {
    const pr = pullRequest({
      reviewers: reviewers('changes-requested'),
      activeCommentCount: 0,
    });
    expect(prBadgeModel(pr, 40).trailing).toBe('🔔');
  });

  it('leaves an approved, comment-free request starred', () => {
    const pr = pullRequest({
      reviewers: reviewers('approved'),
      activeCommentCount: 0,
    });
    expect(prBadgeModel(pr, 40).trailing).toBe('⭐');
  });
});

describe('prBadgeModel — trailing cluster', () => {
  it('marks the build glyph with a wrench so it reads as a build', () => {
    const pr = pullRequest({ buildStatus: 'succeeded' });
    expect(prBadgeModel(pr, 40).trailing).toBe('🔧✅');
  });

  it('spaces the two glyphs only when both are present', () => {
    const both = pullRequest({
      buildStatus: 'failed',
      reviewers: reviewers('changes-requested'),
    });
    expect(prBadgeModel(both, 40).trailing).toBe('🔧🔥 🔔');
  });

  it('is empty when there is neither a build nor an attention glyph', () => {
    // Empty string is what tells the badge not to render the trailing
    // box at all, so it has to be exactly empty.
    const pr = pullRequest({ buildStatus: 'none', reviewers: [] });
    expect(prBadgeModel(pr, 40).trailing).toBe('');
  });
});

describe('prBadgeModel — text', () => {
  it('counts approvals against the reviewer total', () => {
    const pr = pullRequest({
      reviewers: reviewers('approved', 'no-response', 'approved'),
    });
    expect(prBadgeModel(pr, 40).reviewText).toBe('2/3 approved');
  });

  it('says nothing about reviews when there are no reviewers', () => {
    expect(prBadgeModel(pullRequest({ reviewers: [] }), 40).reviewText).toBe(
      ''
    );
  });

  it('singularises a lone comment', () => {
    expect(
      prBadgeModel(pullRequest({ activeCommentCount: 1 }), 40).commentText
    ).toBe('1 comment');
    expect(
      prBadgeModel(pullRequest({ activeCommentCount: 2 }), 40).commentText
    ).toBe('2 comments');
  });

  it('says nothing about comments when there are none', () => {
    expect(
      prBadgeModel(pullRequest({ activeCommentCount: 0 }), 40).commentText
    ).toBe('');
    expect(
      prBadgeModel(pullRequest({ activeCommentCount: undefined }), 40)
        .commentText
    ).toBe('');
  });

  it('wraps the id in an OSC-8 hyperlink when the PR has a URL', () => {
    const pr = pullRequest({ url: 'https://example.com/pr/42' });
    expect(prBadgeModel(pr, 40).idText).toBe(
      '\x1b]8;;https://example.com/pr/42\x07#42\x1b]8;;\x07'
    );
  });

  it('falls back to a plain id when there is no URL', () => {
    expect(prBadgeModel(pullRequest({ url: '' }), 40).idText).toBe('#42');
  });
});

describe('prBadgeModel — innerWidth', () => {
  it('leaves room for the sidebar border', () => {
    expect(prBadgeModel(pullRequest(), 40).innerWidth).toBe(38);
  });

  it('never collapses below a floor on a very narrow sidebar', () => {
    expect(prBadgeModel(pullRequest(), 6).innerWidth).toBe(10);
  });
});
