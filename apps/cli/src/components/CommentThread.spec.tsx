import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { CommentThreadCard, LocalCommentCard } from './CommentThread.js';
import type { ReviewComment } from '@kirby/review-comments';

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
