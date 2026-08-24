import { describe, it, expect } from 'vitest';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { SidebarItem } from '../../host/contract.js';
import { buildAttentionModel } from './attention.js';

function pr(p: Partial<PullRequestInfo>): PullRequestInfo {
  return {
    id: p.id ?? 1,
    title: p.title ?? 't',
    sourceBranch: p.sourceBranch ?? 'b',
    targetBranch: 'main',
    url: 'https://x',
    createdByIdentifier: 'me',
    createdByDisplayName: 'Me',
    ...p,
  };
}

const session = (p: PullRequestInfo): SidebarItem => ({
  kind: 'session',
  session: { name: `s-${p.id}`, running: false },
  pr: p,
  branch: p.sourceBranch,
  isMerged: false,
});
const review = (p: PullRequestInfo): SidebarItem => ({
  kind: 'review-pr',
  pr: p,
  category: 'needs-review',
});

describe('buildAttentionModel', () => {
  it('buckets needs-review, CI failures, changes requested and comments', () => {
    const m = buildAttentionModel(
      [
        review(pr({ id: 1 })),
        session(pr({ id: 2, buildStatus: 'failed' })),
        session(
          pr({
            id: 3,
            reviewers: [
              {
                displayName: 'R',
                identifier: 'r',
                decision: 'changes-requested',
              },
            ],
            activeCommentCount: 4,
          })
        ),
      ],
      new Set()
    );
    expect(m.needsReview.entries.map((e) => e.pr.id)).toEqual([1]);
    expect(m.ciFailing.entries.map((e) => e.pr.id)).toEqual([2]);
    expect(m.changesRequested.entries.map((e) => e.pr.id)).toEqual([3]);
    expect(m.unresolvedComments.entries.map((e) => e.pr.id)).toEqual([3]);
    expect(m.unresolvedCommentTotal).toBe(4);
  });

  it('excludes PRs whose tab is open, but tallies them', () => {
    const m = buildAttentionModel(
      [session(pr({ id: 2, buildStatus: 'failed' }))],
      new Set(['pr:2'])
    );
    expect(m.ciFailing.entries).toEqual([]);
    expect(m.ciFailing.openInTabs).toBe(1);
  });

  it('CI failures on review-bucket PRs are not "your PR" failures', () => {
    const m = buildAttentionModel(
      [review(pr({ id: 9, buildStatus: 'failed' }))],
      new Set()
    );
    expect(m.ciFailing.entries).toEqual([]);
    expect(m.needsReview.entries.map((e) => e.pr.id)).toEqual([9]);
  });

  it('counts a PR only once when it appears in multiple rows', () => {
    const p = pr({ id: 5, buildStatus: 'failed' });
    const m = buildAttentionModel([session(p), session(p)], new Set());
    expect(m.ciFailing.entries).toHaveLength(1);
  });
});
