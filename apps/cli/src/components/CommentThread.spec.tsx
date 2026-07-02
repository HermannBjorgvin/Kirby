import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  CommentThreadCard,
  LocalCommentCard,
  planCommentFooter,
} from './CommentThread.js';
import {
  estimateCardRows,
  estimateReplyInputRows,
  type ReviewComment,
} from '@kirby/review-comments';
import { planItemKey } from '../plan/plan-types.js';

// Regression: a selected card with resolved + outdated + a long
// author used to overflow the card's content width — the trailing
// `[r]eply [v]reopen` hint escaped the right border and bled into
// the body row below, mixing hint chars into the rendered body
// (the `[v]reopen` shown next to the body's first line in the
// reported screenshot).

function makeThread(
  overrides: Partial<RemoteCommentThread> = {}
): RemoteCommentThread {
  return {
    id: 't1',
    file: 'src/foo.ts',
    lineStart: 10,
    lineEnd: 10,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: 't1-c1',
        author: 'alice',
        body: 'Body line one body line one body line one body line one body line one.',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 'l1',
    file: 'src/foo.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    severity: 'critical',
    body: 'Local draft body — should appear on its own row, not merged with the header hints.',
    status: 'draft',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CommentThreadCard — header overflow', () => {
  it('renders the header on a single row when selected + resolved + outdated', () => {
    const thread = makeThread({
      isResolved: true,
      isOutdated: true,
      comments: [
        {
          id: 't1-c1',
          author: 'kirby-test-runner',
          body: 'AI generated: nit signal reads inside an RxJS map',
          createdAt: new Date(Date.now() - 7_200_000).toISOString(),
        },
      ],
    });

    const { lastFrame } = render(
      <CommentThreadCard thread={thread} selected maxWidth={80} />
    );

    const visible = stripAnsi(lastFrame() ?? '');
    const rows = visible.split('\n');
    for (const r of rows) {
      expect(r.length).toBeLessThanOrEqual(82);
    }
    // Regression: the header used to span two rows because each
    // sibling <Text> got a flex-shrunk column allocation and
    // wrapped within it ("kirby-test-run | er", " · 2h | ago",
    // " ✓ | resolved", "(outdated", "[r]eply | [v]reopen"). One
    // logical header row should land on exactly one rendered row.
    const headerRowIdx = rows.findIndex((r) => r.includes('[r]eply'));
    expect(headerRowIdx).toBeGreaterThan(-1);
    const headerRow = rows[headerRowIdx]!;
    // Same row must carry every other header span.
    expect(headerRow).toContain('kirby-test-runner');
    expect(headerRow).toContain('[v]reopen');
  });

  it('suppresses [v] hint when canResolve is false (issue comments)', () => {
    const thread = makeThread({ canResolve: false });
    const { lastFrame } = render(
      <CommentThreadCard thread={thread} selected maxWidth={60} />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('[r]eply');
    expect(visible).not.toMatch(/\[v\](resolve|reopen)/);
  });
});

describe('plan-action hint ([a/A])', () => {
  it('renders no plan badge — plan membership shows via the hint only', () => {
    // The old green ◉/✎ badge was dropped; unselected in-plan cards
    // intentionally carry no plan marker text.
    const { lastFrame } = render(
      <CommentThreadCard thread={makeThread()} inPlan maxWidth={80} />
    );
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('plan');
  });

  it('tints the border green on an unselected in-plan card', () => {
    // [32m = green SGR; nothing else on this card is green
    // (isResolved is false), so its presence means the border tint.
    const inPlanFrame = render(
      <CommentThreadCard thread={makeThread()} inPlan maxWidth={80} />
    ).lastFrame();
    const plainFrame = render(
      <CommentThreadCard thread={makeThread()} maxWidth={80} />
    ).lastFrame();
    expect(inPlanFrame).toContain('[32m');
    expect(plainFrame).not.toContain('[32m');
  });

  it('keeps the selection color when a selected card is in plan', () => {
    const { lastFrame } = render(
      <CommentThreadCard thread={makeThread()} selected inPlan maxWidth={80} />
    );
    // Cyan (36) border wins over the green plan tint.
    expect(lastFrame()).toContain('[36m╭');
  });

  it('shows the add hint on a selected remote card not yet in plan', () => {
    const { lastFrame } = render(
      <CommentThreadCard
        thread={makeThread()}
        selected
        planHint
        maxWidth={80}
      />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('[a/A]dd to draft plan');
  });

  it('switches to remove/annotate when the remote card is in plan', () => {
    const { lastFrame } = render(
      <CommentThreadCard
        thread={makeThread()}
        selected
        planHint
        inPlan
        maxWidth={80}
      />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('[a] remove [A] annotate');
    expect(visible).not.toContain('[a/A]dd');
  });

  it('shows no plan hint without planHint (Shift+C pane)', () => {
    const { lastFrame } = render(
      <CommentThreadCard thread={makeThread()} selected maxWidth={80} />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).not.toContain('[a/A]dd');
    expect(visible).not.toContain('[a] remove');
  });

  it('shows no plan hint on an unselected card', () => {
    const { lastFrame } = render(
      <CommentThreadCard thread={makeThread()} planHint maxWidth={80} />
    );
    expect(stripAnsi(lastFrame() ?? '')).not.toContain('[a/A]dd');
  });

  it('shows the add hint on a selected local card not yet in plan', () => {
    const { lastFrame } = render(
      <LocalCommentCard
        comment={makeReview()}
        selected
        planHint
        maxWidth={80}
      />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('[a/A]dd to draft plan');
  });

  it('switches to remove/annotate when the local card is in plan', () => {
    const { lastFrame } = render(
      <LocalCommentCard
        comment={makeReview()}
        selected
        planHint
        inPlan
        maxWidth={80}
      />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    expect(visible).toContain('[a] remove [A] annotate');
    expect(visible).not.toContain('[a/A]dd');
  });
});

describe('LocalCommentCard — header overflow', () => {
  it('renders the header on a single row when selected with full hints', () => {
    const comment = makeReview({
      severity: 'critical',
      status: 'draft',
    });
    const { lastFrame } = render(
      <LocalCommentCard comment={comment} selected maxWidth={40} />
    );
    const visible = stripAnsi(lastFrame() ?? '');
    const rows = visible.split('\n');
    for (const r of rows) {
      expect(r.length).toBeLessThanOrEqual(42);
    }
    // The severity tag and the action hint must land on the same
    // rendered row — same regression as CommentThreadCard.
    const headerRowIdx = rows.findIndex((r) => r.includes('[e]dit'));
    expect(headerRowIdx).toBeGreaterThan(-1);
    const headerRow = rows[headerRowIdx]!;
    expect(headerRow).toContain('[critical]');
  });
});

describe('planCommentFooter — compose-aware spans', () => {
  const WIDTH = 40;

  it('adds buffer-aware reply-input rows to the replying thread', () => {
    const thread = makeThread();
    const base = planCommentFooter([thread], WIDTH).spans[0]!;

    const short = planCommentFooter([thread], WIDTH, {
      replyingToThreadId: 't1',
      replyBuffer: '',
    }).spans[0]!;
    expect(short).toBe(base + estimateReplyInputRows('', WIDTH));

    // A buffer long enough to wrap several input lines grows the span.
    const longBuffer = 'x'.repeat(120);
    const long = planCommentFooter([thread], WIDTH, {
      replyingToThreadId: 't1',
      replyBuffer: longBuffer,
    }).spans[0]!;
    expect(long).toBe(base + estimateReplyInputRows(longBuffer, WIDTH));
    expect(long).toBeGreaterThan(short);
  });

  it('leaves other threads untouched while one is replying', () => {
    const threads = [makeThread(), makeThread({ id: 't2' })];
    const spans = planCommentFooter(threads, WIDTH, {
      replyingToThreadId: 't1',
      replyBuffer: 'hi',
    }).spans;
    expect(spans[1]).toBe(estimateCardRows(threads[1]!, WIDTH));
  });

  it('replaces the card span with the composer estimate while annotating', () => {
    // Long body → tall card; the one-line composer must NOT inherit it.
    const thread = makeThread({
      comments: [
        {
          id: 't1-c1',
          author: 'alice',
          body: 'word '.repeat(80),
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });
    const cardSpan = planCommentFooter([thread], WIDTH).spans[0]!;
    const composerSpan = planCommentFooter([thread], WIDTH, {
      annotatingPlanKey: planItemKey('remote', 't1'),
      annotationBuffer: '',
    }).spans[0]!;
    // border(2) + header(1) + one buffer row + marginBottom(1)
    expect(composerSpan).toBe(5);
    expect(composerSpan).toBeLessThan(cardSpan);
  });
});
