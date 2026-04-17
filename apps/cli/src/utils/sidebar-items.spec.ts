import { describe, it, expect } from 'vitest';
import type { PullRequestInfo, CategorizedReviews } from '@kirby/vcs-core';
import type { AgentSession } from '../types.js';
import { buildSidebarItems } from './sidebar-items.js';

function makePr(
  overrides: Partial<PullRequestInfo> & { id: number }
): PullRequestInfo {
  return {
    title: `PR #${overrides.id}`,
    sourceBranch: `feature/branch-${overrides.id}`,
    targetBranch: 'main',
    url: '',
    createdByIdentifier: 'me@test.com',
    createdByDisplayName: 'Me',
    ...overrides,
  };
}

const emptyReviews: CategorizedReviews = {
  needsReview: [],
  waitingForAuthor: [],
  approvedByYou: [],
};

describe('buildSidebarItems', () => {
  it('returns sessions first with branch/PR/merge/conflict info', () => {
    const sessions: AgentSession[] = [
      { name: 'feature-foo', running: true },
      { name: 'feature-bar', running: false },
    ];
    const pr = makePr({ id: 1 });
    const sessionBranchMap = new Map([
      ['feature-foo', 'feature/foo'],
      ['feature-bar', 'feature/bar'],
    ]);
    const sessionPrMap = new Map([['feature-foo', pr]]);
    const mergedBranches = new Set(['feature/bar']);
    const conflictCounts = new Map([['feature/foo', 3]]);

    const items = buildSidebarItems(
      sessions,
      [],
      emptyReviews,
      sessionBranchMap,
      sessionPrMap,
      mergedBranches,
      conflictCounts
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      kind: 'session',
      session: sessions[0],
      pr,
      branch: 'feature/foo',
      isMerged: false,
      conflictCount: 3,
    });
    expect(items[1]).toEqual({
      kind: 'session',
      session: sessions[1],
      pr: undefined,
      branch: 'feature/bar',
      isMerged: true,
      conflictCount: undefined,
    });
  });

  it('places orphan PRs after sessions, draft before active', () => {
    const activePr = makePr({ id: 10, isDraft: false });
    const draftPr = makePr({ id: 11, isDraft: true });

    const items = buildSidebarItems(
      [],
      [activePr, draftPr],
      emptyReviews,
      new Map(),
      new Map(),
      new Set(),
      new Map()
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: 'orphan-pr', pr: draftPr });
    expect(items[1]).toEqual({ kind: 'orphan-pr', pr: activePr });
  });

  it('places review PRs after orphans in category order', () => {
    const needsReview = makePr({ id: 20 });
    const waiting = makePr({ id: 21 });
    const approved = makePr({ id: 22 });

    const reviews: CategorizedReviews = {
      needsReview: [needsReview],
      waitingForAuthor: [waiting],
      approvedByYou: [approved],
    };

    const items = buildSidebarItems(
      [],
      [],
      reviews,
      new Map(),
      new Map(),
      new Set(),
      new Map()
    );

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      kind: 'review-pr',
      pr: needsReview,
      category: 'needs-review',
    });
    expect(items[1]).toEqual({
      kind: 'review-pr',
      pr: waiting,
      category: 'waiting',
    });
    expect(items[2]).toEqual({
      kind: 'review-pr',
      pr: approved,
      category: 'approved',
    });
  });

  it('combines all sections in the correct order', () => {
    const session: AgentSession = { name: 'my-session', running: true };
    const orphan = makePr({ id: 5 });
    const review = makePr({ id: 30 });

    const items = buildSidebarItems(
      [session],
      [orphan],
      { needsReview: [review], waitingForAuthor: [], approvedByYou: [] },
      new Map(),
      new Map(),
      new Set(),
      new Map()
    );

    expect(items.map((i) => i.kind)).toEqual([
      'session',
      'orphan-pr',
      'review-pr',
    ]);
  });

  it('returns empty array when all inputs are empty', () => {
    const items = buildSidebarItems(
      [],
      [],
      emptyReviews,
      new Map(),
      new Map(),
      new Set(),
      new Map()
    );
    expect(items).toEqual([]);
  });
});
