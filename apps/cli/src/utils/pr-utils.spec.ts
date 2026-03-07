import { describe, it, expect } from 'vitest';
import type {
  BranchPrMap,
  PullRequestInfo,
  AppConfig,
  VcsProvider,
} from '@kirby/vcs-core';
import {
  findOrphanPrs,
  categorizeReviews,
  buildSessionLookups,
} from './pr-utils.js';

// Minimal mock provider
const mockProvider: VcsProvider = {
  id: 'mock',
  displayName: 'Mock',
  authFields: [],
  projectFields: [],
  parseRemoteUrl: () => null,
  isConfigured: () => true,
  matchesUser: (identifier, config) => identifier === config.email,
  fetchPullRequests: async () => ({}),
  getPullRequestUrl: () => '',
};

const mockConfig: AppConfig = {
  email: 'me@test.com',
  vendorAuth: {},
  vendorProject: {},
};

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

describe('findOrphanPrs', () => {
  it('returns PRs that have no matching session', () => {
    const prMap: BranchPrMap = {
      'feature/branch-1': makePr({ id: 1 }),
      'feature/branch-2': makePr({ id: 2 }),
      'feature/branch-3': makePr({ id: 3 }),
    };
    // branchToSessionName('feature/branch-2') → 'feature-branch-2'
    const sessionNames = new Set(['feature-branch-2']);

    const result = findOrphanPrs(prMap, sessionNames, mockConfig, mockProvider);
    expect(result.map((p) => p.id)).toEqual([3, 1]); // sorted descending
  });

  it('excludes PRs from other users', () => {
    const prMap: BranchPrMap = {
      'feature/branch-1': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
      }),
    };
    const result = findOrphanPrs(prMap, new Set(), mockConfig, mockProvider);
    expect(result).toEqual([]);
  });

  it('handles null entries in prMap', () => {
    const prMap: BranchPrMap = {
      'feature/branch-1': null,
    };
    const result = findOrphanPrs(prMap, new Set(), mockConfig, mockProvider);
    expect(result).toEqual([]);
  });
});

describe('categorizeReviews', () => {
  it('categorizes PRs by reviewer decision', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'no-response',
          },
        ],
      }),
      'branch-b': makePr({
        id: 2,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'approved',
          },
        ],
      }),
      'branch-c': makePr({
        id: 3,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'changes-requested',
          },
        ],
      }),
    };

    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview.map((p) => p.id)).toEqual([1]);
    expect(result.approvedByYou.map((p) => p.id)).toEqual([2]);
    expect(result.waitingForAuthor.map((p) => p.id)).toEqual([3]);
  });

  it('skips declined reviewers', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Me',
            identifier: 'me@test.com',
            decision: 'declined',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview).toEqual([]);
    expect(result.approvedByYou).toEqual([]);
    expect(result.waitingForAuthor).toEqual([]);
  });

  it('skips PRs where user is not a reviewer', () => {
    const prMap: BranchPrMap = {
      'branch-a': makePr({
        id: 1,
        createdByIdentifier: 'other@test.com',
        reviewers: [
          {
            displayName: 'Other',
            identifier: 'other@test.com',
            decision: 'no-response',
          },
        ],
      }),
    };
    const result = categorizeReviews(prMap, mockConfig, mockProvider);
    expect(result.needsReview).toEqual([]);
  });
});

describe('buildSessionLookups', () => {
  it('builds name-to-branch and name-to-PR maps', () => {
    const pr1 = makePr({ id: 1, sourceBranch: 'feature/foo' });
    const prMap: BranchPrMap = {
      'feature/foo': pr1,
      'feature/bar': null,
    };

    const { sessionBranchMap, sessionPrMap } = buildSessionLookups(prMap);
    expect(sessionBranchMap.get('feature-foo')).toBe('feature/foo');
    expect(sessionBranchMap.get('feature-bar')).toBe('feature/bar');
    expect(sessionPrMap.get('feature-foo')).toBe(pr1);
    expect(sessionPrMap.has('feature-bar')).toBe(false);
  });
});
