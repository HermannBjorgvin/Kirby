import { describe, expect, it } from 'vitest';
import type { PullRequestInfo, ReviewDecision } from '@kirby/vcs-core';
import type { SidebarItem } from '../../../host/contract.js';
import {
  applyPendingRemovals,
  prStatusIndicator,
  groupSections,
  itemBranch,
  itemHasWorktree,
  itemKey,
  itemRunning,
  itemSessionName,
  itemTitle,
  unresolvedCommentsLabel,
  SECTION_ORDER,
  liveSessionName,
} from './sidebar-model.js';

/**
 * The desktop keys editor tabs by `itemKey`, and the tab strip survives
 * a PR's whole life only because that key does not change as the item
 * moves between sidebar kinds. A PR starts as an `orphan-pr` (or a
 * `review-pr`), becomes a session-backed row when an agent is launched
 * on it, and can go back — every step is the same tab.
 *
 * These tests pin that identity contract and the ordering the sidebar
 * relies on, rather than restating each accessor's one-line body.
 */

function pr(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 42,
    title: 'Add colour support',
    sourceBranch: 'feature/colour',
    targetBranch: 'main',
    createdByDisplayName: 'someone',
    isDraft: false,
    url: 'https://example.test/pr/42',
    ...overrides,
  } as PullRequestInfo;
}

function session(name: string, running = false) {
  return { name, running };
}

describe('itemKey identity across kinds', () => {
  const thePr = pr();

  const asOrphan: SidebarItem = { kind: 'orphan-pr', pr: thePr };
  const asReview: SidebarItem = {
    kind: 'review-pr',
    pr: thePr,
    category: 'needs-review',
  };
  const asSession: SidebarItem = {
    kind: 'session',
    session: session('feature-colour'),
    pr: thePr,
    branch: 'feature/colour',
    isMerged: false,
  };

  it('keys the same PR identically however it arrives', () => {
    // Launching an agent on a PR turns an orphan/review row into a
    // session-backed one. A key that changed here would strand the tab
    // the user is looking at.
    expect(itemKey(asOrphan)).toBe(itemKey(asSession));
    expect(itemKey(asReview)).toBe(itemKey(asSession));
    expect(itemKey(asOrphan)).toBe('pr:42');
  });

  it('keys a PR-less worktree by branch, not by session name', () => {
    // The two differ whenever the branch contains a slash, and the tab
    // model stamps `branch` alongside the key to recover from a re-key.
    const worktree: SidebarItem = {
      kind: 'session',
      session: session('feature-colour'),
      branch: 'feature/colour',
      isMerged: false,
    };
    expect(itemKey(worktree)).toBe('branch:feature/colour');
    expect(itemBranch(worktree)).toBe('feature/colour');
  });

  it('agrees between itemKey and itemBranch when branch is absent', () => {
    // Older/degenerate rows carry no `branch`; both accessors must then
    // fall back to the same value, or the close-tab branch fallback
    // would look up a branch the key never used.
    const noBranch: SidebarItem = {
      kind: 'session',
      session: session('solo'),
      isMerged: false,
    };
    expect(itemKey(noBranch)).toBe('branch:solo');
    expect(itemBranch(noBranch)).toBe('solo');
  });

  it('reports the PR branch for PR-only rows', () => {
    expect(itemBranch(asOrphan)).toBe('feature/colour');
    expect(itemBranch(asReview)).toBe('feature/colour');
  });

  it('gives every worktree a session name, live or not', () => {
    // This is why "does a session name exist" is not a liveness test:
    // an idle worktree has one too. Code that wants liveness must use
    // itemRunning.
    const idle: SidebarItem = {
      kind: 'session',
      session: session('idle-branch', false),
      isMerged: false,
    };
    expect(itemSessionName(idle)).toBe('idle-branch');
    expect(itemSessionName({ kind: 'orphan-pr', pr: thePr })).toBeUndefined();
  });
});

describe('groupSections', () => {
  const items: SidebarItem[] = [
    { kind: 'session', session: session('plain'), isMerged: false },
    {
      kind: 'review-pr',
      pr: pr({ id: 1 }),
      category: 'needs-review',
    },
    {
      kind: 'session',
      session: session('drafty'),
      pr: pr({ id: 2, isDraft: true }),
      isMerged: false,
    },
    { kind: 'orphan-pr', pr: pr({ id: 3 }) },
    { kind: 'review-pr', pr: pr({ id: 4 }), category: 'approved' },
    { kind: 'review-pr', pr: pr({ id: 5 }), category: 'waiting' },
  ];

  it('emits sections in the fixed order regardless of input order', () => {
    const keys = groupSections(items).map((s) => s.key);
    expect(keys).toEqual([
      'worktrees',
      'draft-pull-requests',
      'pull-requests',
      'needs-review',
      'waiting',
      'approved',
    ]);
    // …which is the declared order, filtered to what is present.
    expect(keys).toEqual(SECTION_ORDER.filter((k) => keys.includes(k)));
  });

  it('omits empty sections rather than rendering headers with no rows', () => {
    const onlyWorktrees = groupSections([items[0]]);
    expect(onlyWorktrees.map((s) => s.key)).toEqual(['worktrees']);
  });

  it('preserves the incoming order within a section', () => {
    // The host hands the list back already sorted the way the TUI sorts
    // it; grouping must not resort it.
    const many: SidebarItem[] = [
      { kind: 'session', session: session('b'), isMerged: false },
      { kind: 'session', session: session('a'), isMerged: false },
      { kind: 'session', session: session('c'), isMerged: false },
    ];
    expect(groupSections(many)[0].items.map(itemBranch)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('files a draft PR under drafts whether or not it has a worktree', () => {
    const draftOrphan: SidebarItem = {
      kind: 'orphan-pr',
      pr: pr({ id: 9, isDraft: true }),
    };
    expect(groupSections([draftOrphan])[0].key).toBe('draft-pull-requests');
  });

  it('keeps every item — grouping loses nothing', () => {
    const total = groupSections(items).reduce((n, s) => n + s.items.length, 0);
    expect(total).toBe(items.length);
  });
});

/**
 * What the window shows between "Remove" being clicked and git being
 * done. The mistake worth guarding is treating both row kinds the same:
 * hiding every row for the branch blanks a pull request that is still
 * open, and hiding neither leaves a worktree on screen that is already
 * being deleted.
 */
describe('applyPendingRemovals', () => {
  const branch = 'feature/colour';
  const worktreeRow: SidebarItem = {
    kind: 'session',
    session: session('feature-colour', true),
    branch,
    isMerged: false,
  };
  const reviewRow: SidebarItem = {
    kind: 'review-pr',
    pr: pr({ sourceBranch: branch }),
    category: 'needs-review',
    sessionName: 'feature-colour',
    running: true,
  };

  it('returns the list untouched when nothing is being removed', () => {
    const items = [worktreeRow, reviewRow];
    expect(applyPendingRemovals(items, new Set())).toBe(items);
  });

  it('drops the worktree row — the row is the worktree', () => {
    expect(applyPendingRemovals([worktreeRow], new Set([branch]))).toEqual([]);
  });

  it('keeps the PR row, because the pull request outlives its checkout', () => {
    const [row] = applyPendingRemovals([reviewRow], new Set([branch]));
    expect(row.kind).toBe('review-pr');
    expect(row.pr?.id).toBe(reviewRow.pr?.id);
  });

  it('strips the worktree state off the PR row it keeps', () => {
    // This is what takes "Stop agent" and "Remove worktree…" out of the
    // row's context menu and stops its running indicator, rather than
    // leaving them live against a worktree that is going away.
    const [row] = applyPendingRemovals([reviewRow], new Set([branch]));
    expect(itemHasWorktree(row)).toBe(false);
    expect(itemRunning(row)).toBe(false);
  });

  it('leaves rows for other branches completely alone', () => {
    const other: SidebarItem = {
      kind: 'session',
      session: session('unrelated', true),
      branch: 'unrelated',
      isMerged: false,
    };
    expect(applyPendingRemovals([other], new Set([branch]))).toEqual([other]);
  });

  it('does not mutate the item it was given', () => {
    applyPendingRemovals([reviewRow], new Set([branch]));
    expect(reviewRow.sessionName).toBe('feature-colour');
    expect(reviewRow.running).toBe(true);
  });
});

/**
 * The status cluster on a pull request row.
 *
 * One circle stands for two independent facts, and every visual channel
 * is a decision: colour is the worst thing in the way, glyph is which
 * axis that thing is, fill is nothing outstanding at all. The grid
 * below is the agreed table written down, and it is asserted whole
 * rather than by example — the bugs here have all been cells nobody
 * thought to check. A green circle with a failing build inside it
 * shipped precisely because "approved" and "CI failed" were only ever
 * tested apart.
 */
describe('prStatusIndicator', () => {
  const isBlocking = (d: ReviewDecision) =>
    d === 'changes-requested' || d === 'waiting-for-author' || d === 'rejected';
  const call = (decisions: ReviewDecision[], ci?: string) =>
    prStatusIndicator(
      decisions.map((decision) => ({ decision })),
      ci,
      isBlocking
    );

  const REJECTED: ReviewDecision[] = ['rejected', 'approved'];
  const BLOCKED: ReviewDecision[] = ['waiting-for-author', 'no-response'];
  const APPROVED: ReviewDecision[] = ['approved', 'approved'];
  const PARTIAL: ReviewDecision[] = ['approved', 'no-response'];

  /** reviewers × CI → tone, glyph. The table, verbatim. */
  const GRID: [string, ReviewDecision[], string | undefined, string, string][] =
    [
      ['rejected + passed', REJECTED, 'succeeded', 'red', 'rejected'],
      ['rejected + failed', REJECTED, 'failed', 'red', 'rejected'],
      ['rejected + running', REJECTED, 'pending', 'red', 'rejected'],
      ['rejected + no result', REJECTED, undefined, 'red', 'rejected'],

      ['waiting + passed', BLOCKED, 'succeeded', 'yellow', 'waiting'],
      ['waiting + failed', BLOCKED, 'failed', 'red', 'ci-failed'],
      ['waiting + running', BLOCKED, 'pending', 'yellow', 'waiting'],
      ['waiting + no result', BLOCKED, undefined, 'yellow', 'waiting'],

      ['approved + passed', APPROVED, 'succeeded', 'green', 'approved'],
      ['approved + failed', APPROVED, 'failed', 'red', 'ci-failed'],
      ['approved + running', APPROVED, 'pending', 'yellow', 'ci-running'],
      ['approved + no result', APPROVED, undefined, 'green', 'ci-absent'],

      ['partial + passed', PARTIAL, 'succeeded', 'muted', 'partial'],
      ['partial + failed', PARTIAL, 'failed', 'red', 'ci-failed'],
      ['partial + running', PARTIAL, 'pending', 'yellow', 'ci-running'],
      ['partial + no result', PARTIAL, undefined, 'muted', 'partial'],
    ];

  it.each(GRID)('%s → %s %s', (_name, decisions, ci, tone, glyph) => {
    const out = call(decisions, ci);
    expect({ tone: out.tone, glyph: out.glyph }).toEqual({ tone, glyph });
  });

  it('always shows red when CI failed, whatever the reviewers say', () => {
    // The reported bug: an approved request with a red build drew green.
    for (const [, decisions] of GRID) {
      expect(call(decisions, 'failed').tone).toBe('red');
    }
  });

  it('always shows red when a reviewer rejected, whatever CI says', () => {
    for (const ci of ['succeeded', 'failed', 'pending', undefined]) {
      expect(call(REJECTED, ci).tone).toBe('red');
    }
  });

  it('never draws a tick inside a rejection', () => {
    // A green check in a red circle is what made this unreadable.
    for (const ci of ['succeeded', 'failed', 'pending', undefined]) {
      expect(call(REJECTED, ci).glyph).toBe('rejected');
    }
  });

  it('does not let a passing build turn an unapproved request green', () => {
    // CI can escalate a row's urgency; it cannot vouch for it.
    expect(call(PARTIAL, 'succeeded').tone).toBe('muted');
    expect(call([], 'succeeded').tone).toBe('muted');
  });

  it('keeps both axes readable however the glyph resolves', () => {
    // Whichever axis wins the glyph, the other is still recoverable —
    // approvals from the count, CI from the sentence.
    for (const [, decisions, ci] of GRID) {
      const out = call(decisions, ci);
      expect(out.total).toBe(decisions.length);
      expect(out.label).toMatch(/CI (passed|failed|running)|No CI result/);
    }
  });

  it('fills the shape only when nothing at all is outstanding', () => {
    expect(call(APPROVED, 'succeeded').filled).toBe(true);
    for (const [, decisions, ci] of GRID) {
      const out = call(decisions, ci);
      if (out.approval === 'approved' && out.ci === 'passed') continue;
      expect(out.filled).toBe(false);
    }
  });

  it('says a fully green request can be merged rather than making you infer it', () => {
    expect(call(APPROVED, 'succeeded').label).toBe(
      'Ready to merge — CI passed, all 2 reviewers approved'
    );
  });

  it('names both axes in every other cell', () => {
    expect(
      call(['waiting-for-author', 'no-response', 'no-response']).label
    ).toBe('No CI result — waiting for the author (0 of 3 reviewers approved)');
    expect(call(APPROVED, undefined).label).toBe(
      'No CI result — all 2 reviewers approved'
    );
    expect(call(PARTIAL, 'succeeded').label).toBe(
      'CI passed — waiting on 1 approval (1 of 2 reviewers approved)'
    );
    expect(call(PARTIAL, 'failed').label).toBe(
      'CI failed — waiting on 1 approval (1 of 2 reviewers approved)'
    );
  });

  it('handles a pull request nobody is reviewing yet', () => {
    const out = call([], 'succeeded');
    expect(out.total).toBe(0);
    expect(out.tone).toBe('muted');
    expect(out.label).toBe('CI passed — no reviewers yet');
  });
});

describe('status cluster tooltips', () => {
  it('calls comments unresolved, and gets the plural right', () => {
    expect(unresolvedCommentsLabel(1)).toBe('1 unresolved comment');
    expect(unresolvedCommentsLabel(3)).toBe('3 unresolved comments');
  });
});

// ── liveSessionName ──────────────────────────────────────────────

/**
 * Every worktree row carries a session *name* whether or not an agent
 * has ever run in it — the name is derived from the branch. Treating
 * that as "a session exists" is what made a fresh worktree offer to
 * relaunch an agent it never had.
 */
describe('liveSessionName', () => {
  it('keeps a name the host has actually launched', () => {
    expect(liveSessionName('feature-x', [{ name: 'feature-x' }])).toBe(
      'feature-x'
    );
  });

  it('drops a name no session exists for', () => {
    expect(liveSessionName('feature-x', [{ name: 'other' }])).toBeUndefined();
    expect(liveSessionName('feature-x', [])).toBeUndefined();
  });

  it('has nothing to resolve when the row has no name', () => {
    expect(liveSessionName(undefined, [{ name: 'feature-x' }])).toBeUndefined();
  });
});

describe('itemTitle', () => {
  it('is the pull request title whenever the item has one', () => {
    const thePr = pr({ title: 'Add colour support' });
    const asSession: SidebarItem = {
      kind: 'session',
      session: session('feature-colour'),
      pr: thePr,
      branch: 'feature/colour',
      isMerged: false,
    };
    const asOrphan: SidebarItem = { kind: 'orphan-pr', pr: thePr };
    const asReview: SidebarItem = {
      kind: 'review-pr',
      pr: thePr,
      category: 'needs-review',
    };
    for (const item of [asSession, asOrphan, asReview]) {
      expect(itemTitle(item)).toBe('Add colour support');
    }
  });

  it('is the branch for a worktree without one', () => {
    const item: SidebarItem = {
      kind: 'session',
      session: session('feature-colour'),
      branch: 'feature/colour',
      isMerged: false,
    };
    expect(itemTitle(item)).toBe('feature/colour');
    expect(itemTitle({ ...item, branch: undefined })).toBe('feature-colour');
  });
});
