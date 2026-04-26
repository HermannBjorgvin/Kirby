import { describe, it, expect } from 'vitest';
import type { CategorizedReviews, PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem, AgentSession } from '../types.js';
import { resolveSelectedIndex, translateSelectKey } from './SidebarContext.js';

function session(name: string): SidebarItem {
  const s: AgentSession = { name, running: false };
  return { kind: 'session', session: s, isMerged: false };
}

function makePr(id: number, sourceBranch: string): PullRequestInfo {
  return {
    id,
    sourceBranch,
    targetBranch: 'main',
    title: `PR #${id}`,
    isDraft: false,
    createdByIdentifier: 'someone',
    url: `https://example.com/pr/${id}`,
  } as unknown as PullRequestInfo;
}

function makeCr(parts: Partial<CategorizedReviews> = {}): CategorizedReviews {
  return {
    needsReview: parts.needsReview ?? [],
    waitingForAuthor: parts.waitingForAuthor ?? [],
    approvedByYou: parts.approvedByYou ?? [],
  };
}

describe('resolveSelectedIndex', () => {
  it('returns 0 when the list is empty', () => {
    expect(resolveSelectedIndex([], null, 0)).toBe(0);
    expect(resolveSelectedIndex([], 'session:foo', 5)).toBe(0);
  });

  it('returns 0 when selectedKey is null', () => {
    const items = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(items, null, 2)).toBe(0);
  });

  it('follows the selected item across a reorder', () => {
    const before = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(before, 'session:b', 0)).toBe(1);

    const after = [session('c'), session('b'), session('a')];
    expect(resolveSelectedIndex(after, 'session:b', 1)).toBe(1);

    const swapped = [session('b'), session('a'), session('c')];
    expect(resolveSelectedIndex(swapped, 'session:b', 1)).toBe(0);
  });

  it('falls back to lastValidIndex when the selected item was removed', () => {
    const before = [session('a'), session('b'), session('c')];
    expect(resolveSelectedIndex(before, 'session:b', 0)).toBe(1);

    // 'b' is gone → lastValidIndex (1) maps to current items[1] = 'c'.
    const after = [session('a'), session('c')];
    expect(resolveSelectedIndex(after, 'session:b', 1)).toBe(1);
  });

  it('clamps the fallback to the new list length', () => {
    const before = [session('a'), session('b'), session('c')];
    // Selected the last row, then that row and the two before it get
    // deleted, leaving only one item.
    expect(resolveSelectedIndex(before, 'session:c', 2)).toBe(2);

    const after = [session('a')];
    expect(resolveSelectedIndex(after, 'session:c', 2)).toBe(0);
  });

  it('clamps negative lastValidIndex to 0', () => {
    const items = [session('a'), session('b')];
    // Fallback path (missing key) with an unexpected negative fallback
    // still produces a valid index — guards against ref drift.
    expect(resolveSelectedIndex(items, 'session:missing', -3)).toBe(0);
  });

  it('returns 0 when the key matches no item and lastValidIndex is 0', () => {
    const items = [session('a'), session('b')];
    expect(resolveSelectedIndex(items, 'session:missing', 0)).toBe(0);
  });
});

describe('translateSelectKey', () => {
  it('returns non-session keys unchanged', () => {
    const cr = makeCr();
    expect(translateSelectKey('review:42', new Map(), new Map(), cr)).toBe(
      'review:42'
    );
    expect(translateSelectKey('orphan:7', new Map(), new Map(), cr)).toBe(
      'orphan:7'
    );
  });

  it('returns session keys unchanged when the session has no PR', () => {
    const cr = makeCr();
    const sessionBranchMap = new Map([['my-feature', 'feature/my-feature']]);
    const sessionPrMap = new Map<string, PullRequestInfo>();
    expect(
      translateSelectKey(
        'session:my-feature',
        sessionBranchMap,
        sessionPrMap,
        cr
      )
    ).toBe('session:my-feature');
  });

  it('returns session keys unchanged when the PR is non-review (orphan/active by user)', () => {
    // Author-side PR: the session row is rendered as `kind: 'session'`
    // (active-pr section). selectByKey('session:foo') should match the
    // session row directly — no translation needed.
    const pr = makePr(99, 'feature/mine');
    const sessionBranchMap = new Map([['feature-mine', 'feature/mine']]);
    const sessionPrMap = new Map([['feature-mine', pr]]);
    const cr = makeCr(); // PR is NOT in any review category
    expect(
      translateSelectKey(
        'session:feature-mine',
        sessionBranchMap,
        sessionPrMap,
        cr
      )
    ).toBe('session:feature-mine');
  });

  it('translates to review:${prId} when the branch is in needsReview', () => {
    const pr = makePr(38, 'fixture/add-undo-feature');
    const sessionBranchMap = new Map([
      ['fixture-add-undo-feature', 'fixture/add-undo-feature'],
    ]);
    const sessionPrMap = new Map([['fixture-add-undo-feature', pr]]);
    const cr = makeCr({ needsReview: [pr] });
    expect(
      translateSelectKey(
        'session:fixture-add-undo-feature',
        sessionBranchMap,
        sessionPrMap,
        cr
      )
    ).toBe('review:38');
  });

  it('translates to review:${prId} when the branch is in waitingForAuthor', () => {
    const pr = makePr(38, 'fixture/add-undo-feature');
    const sessionBranchMap = new Map([
      ['fixture-add-undo-feature', 'fixture/add-undo-feature'],
    ]);
    const sessionPrMap = new Map([['fixture-add-undo-feature', pr]]);
    const cr = makeCr({ waitingForAuthor: [pr] });
    expect(
      translateSelectKey(
        'session:fixture-add-undo-feature',
        sessionBranchMap,
        sessionPrMap,
        cr
      )
    ).toBe('review:38');
  });

  it('translates to review:${prId} when the branch is in approvedByYou', () => {
    const pr = makePr(37, 'fixture/add-color-support');
    const sessionBranchMap = new Map([
      ['fixture-add-color-support', 'fixture/add-color-support'],
    ]);
    const sessionPrMap = new Map([['fixture-add-color-support', pr]]);
    const cr = makeCr({ approvedByYou: [pr] });
    expect(
      translateSelectKey(
        'session:fixture-add-color-support',
        sessionBranchMap,
        sessionPrMap,
        cr
      )
    ).toBe('review:37');
  });
});
