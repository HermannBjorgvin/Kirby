import { describe, it, expect } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import {
  type ReviewComment,
  type AnnotatedLine,
  computeInsertionMap,
  computeRemoteInsertionMap,
  getCommentPositions,
  interleaveComments,
} from '@kirby/review-comments';

// Milestone 2 of the UX-parity plan: threads render as Ink cards. The
// annotated-line stream now carries thread/comment objects directly
// (one entry per thread) instead of pre-rendered ANSI header+body
// strings. These tests lock in that schema so downstream renderers can
// safely switch on `line.type`.

function makeDiffLines(
  specs: { oldLine?: number; newLine?: number }[]
): DiffLine[] {
  return specs.map((s) => ({
    type: 'context' as const,
    content: 'x',
    oldLine: s.oldLine,
    newLine: s.newLine,
  }));
}

function makeComment(
  overrides: Partial<ReviewComment> & { id: string }
): ReviewComment {
  return {
    file: 'test.ts',
    lineStart: 1,
    lineEnd: 1,
    severity: 'minor',
    body: 'test comment',
    side: 'RIGHT',
    status: 'draft',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRemoteThread(
  overrides: Partial<RemoteCommentThread> & { id: string }
): RemoteCommentThread {
  return {
    id: overrides.id,
    file: 'test.ts',
    lineStart: 1,
    lineEnd: 1,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    comments: [
      {
        id: `${overrides.id}-root`,
        author: 'alice',
        body: 'remote comment',
        createdAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

// Narrow helpers — assert the line kind is what we expect, returning
// the refined type so the tests can read the payload without casts.
function assertRemoteThread(
  line: AnnotatedLine
): Extract<AnnotatedLine, { type: 'thread-remote' }> {
  if (line.type !== 'thread-remote')
    throw new Error(`expected thread-remote, got ${line.type}`);
  return line;
}
function assertLocalComment(
  line: AnnotatedLine
): Extract<AnnotatedLine, { type: 'thread-local' }> {
  if (line.type !== 'thread-local')
    throw new Error(`expected thread-local, got ${line.type}`);
  return line;
}

// ── computeInsertionMap (unchanged) ────────────────────────────────

describe('computeInsertionMap', () => {
  it('maps RIGHT-side comments by newLine', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
      { oldLine: 3, newLine: 3 },
    ]);
    const comments = [makeComment({ id: 'c1', lineStart: 2, lineEnd: 2 })];
    const map = computeInsertionMap(diffLines, comments);

    expect(map.insertions.get(1)).toHaveLength(1);
    expect(map.insertions.get(1)![0].id).toBe('c1');
    expect(map.outOfDiff).toHaveLength(0);
  });

  it('puts comments anchored to lines outside the diff onto the closest earlier line', () => {
    // computeInsertionMap falls back to the last diff line when a
    // comment's lineEnd is past any known line, so inline comments on
    // "line 99" on a 1-line diff still surface at the end of the diff
    // rather than disappearing to the out-of-diff tail. This is
    // existing behavior; documented here as a regression guard.
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const comments = [makeComment({ id: 'c1', lineStart: 99, lineEnd: 99 })];
    const map = computeInsertionMap(diffLines, comments);

    expect(map.insertions.get(0)).toHaveLength(1);
    expect(map.outOfDiff).toHaveLength(0);
  });
});

// ── New schema: interleaveComments emits thread/comment entries ────

describe('interleaveComments — annotated-line schema', () => {
  it('emits one `thread-local` entry per local comment, carrying the comment object', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    const comments = [
      makeComment({ id: 'c1', lineStart: 2, lineEnd: 2, body: 'body' }),
    ];

    const { lines } = interleaveComments(diffLines, comments, null);

    const localEntries = lines.filter((l) => l.type === 'thread-local');
    expect(localEntries).toHaveLength(1);
    const entry = assertLocalComment(localEntries[0]);
    expect(entry.comment.id).toBe('c1');
    expect(entry.comment.body).toBe('body');
  });

  it('emits one `thread-remote` entry per remote thread, carrying the thread object', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    const threads = [makeRemoteThread({ id: 't1', lineStart: 2, lineEnd: 2 })];

    const { lines } = interleaveComments(diffLines, [], null, threads);

    const remoteEntries = lines.filter((l) => l.type === 'thread-remote');
    expect(remoteEntries).toHaveLength(1);
    const entry = assertRemoteThread(remoteEntries[0]);
    expect(entry.thread.id).toBe('t1');
    expect(entry.thread.comments[0].author).toBe('alice');
  });

  it('inserts thread entries at the diff-line position (anchored)', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
      { oldLine: 3, newLine: 3 },
    ]);
    const threads = [makeRemoteThread({ id: 't1', lineStart: 2, lineEnd: 2 })];

    const { lines } = interleaveComments(diffLines, [], null, threads);

    // Order should be: diff0, diff1, thread-remote, diff2
    expect(lines).toHaveLength(4);
    expect(lines[0].type).toBe('diff');
    expect(lines[1].type).toBe('diff');
    expect(lines[2].type).toBe('thread-remote');
    expect(lines[3].type).toBe('diff');
  });

  it('diff-typed entries carry the structured DiffLine (no pre-rendered ANSI)', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const { lines } = interleaveComments(diffLines, [], null);

    const diffEntries = lines.filter((l) => l.type === 'diff');
    expect(diffEntries).toHaveLength(1);
    if (diffEntries[0].type !== 'diff') throw new Error('expected diff');
    expect(diffEntries[0].line).toBe(diffLines[0]);
    expect(diffEntries[0].highlighted).toBe(false);
  });

  it('hides local comments with status "posted" — regression guard', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    const posted = [
      makeComment({
        id: 'c1',
        lineStart: 2,
        lineEnd: 2,
        status: 'posted',
      }),
    ];
    const threads = [makeRemoteThread({ id: 't1', lineStart: 2, lineEnd: 2 })];

    const { lines } = interleaveComments(diffLines, posted, null, threads);

    // Only the remote thread should be an annotated entry; the posted
    // local is filtered out to avoid double-rendering.
    const threadEntries = lines.filter(
      (l) => l.type === 'thread-local' || l.type === 'thread-remote'
    );
    expect(threadEntries).toHaveLength(1);
    expect(threadEntries[0].type).toBe('thread-remote');
  });

  it('draft locals still render alongside remote threads', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    const locals = [
      makeComment({ id: 'c-draft', lineStart: 1, lineEnd: 1, status: 'draft' }),
      makeComment({
        id: 'c-posted',
        lineStart: 1,
        lineEnd: 1,
        status: 'posted',
      }),
    ];
    const threads = [makeRemoteThread({ id: 't1', lineStart: 2, lineEnd: 2 })];

    const { lines } = interleaveComments(diffLines, locals, null, threads);

    const localEntries = lines.filter((l) => l.type === 'thread-local');
    const remoteEntries = lines.filter((l) => l.type === 'thread-remote');
    expect(localEntries).toHaveLength(1);
    const local = assertLocalComment(localEntries[0]);
    expect(local.comment.id).toBe('c-draft');
    expect(remoteEntries).toHaveLength(1);
  });

  it('appends a general-comments section at the end when generalComments provided', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const general = [
      makeRemoteThread({
        id: 'g1',
        file: null,
        lineStart: null,
        lineEnd: null,
      }),
    ];

    const { lines, sectionAnchors } = interleaveComments(
      diffLines,
      [],
      null,
      undefined,
      general
    );

    const threadEntries = lines.filter((l) => l.type === 'thread-remote');
    expect(threadEntries).toHaveLength(1);
    const entry = assertRemoteThread(threadEntries[0]);
    expect(entry.thread.id).toBe('g1');
    // An anchor for the general section should be registered.
    expect(sectionAnchors.length).toBeGreaterThan(1);
  });
});

// ── getCommentPositions — thread entries are 1 line each ────────────

describe('getCommentPositions (new schema)', () => {
  it('returns the annotated-line index of each thread entry', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
      { oldLine: 3, newLine: 3 },
    ]);
    const comments = [makeComment({ id: 'c1', lineStart: 2, lineEnd: 2 })];

    const result = interleaveComments(diffLines, comments, null);
    const positions = getCommentPositions(
      result.lines,
      result.insertionMap,
      comments
    );

    expect(positions.has('c1')).toBe(true);
    const info = positions.get('c1')!;
    // c1 is inserted right after diff line 1 (index 1), so its
    // thread-local entry is at annotated-line index 2 (headerLine).
    // refStartLine points at the referenced diff row itself, so the
    // viewport centers on the code not the card — that's annotated
    // index 1 (diff line 2's position).
    expect(info.headerLine).toBe(2);
    expect(info.refStartLine).toBe(1);
  });

  it('returns positions for remote threads too', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    const threads = [makeRemoteThread({ id: 't1', lineStart: 2, lineEnd: 2 })];

    const result = interleaveComments(diffLines, [], null, threads);
    const positions = getCommentPositions(
      result.lines,
      result.insertionMap,
      []
    );

    // Remote thread is at index 2 (after diff0, diff1).
    expect(positions.get('t1')?.headerLine).toBe(2);
  });
});

// ── Highlighting flag on diff rows ────────────────────────────────

describe('interleaveComments highlighting', () => {
  it('flags referenced diff lines with highlighted=true when a local comment is selected', () => {
    const diffLines = makeDiffLines(
      Array.from({ length: 10 }, (_, i) => ({
        oldLine: i + 1,
        newLine: i + 1,
      }))
    );
    const comments = [makeComment({ id: 'c1', lineStart: 3, lineEnd: 5 })];

    const { lines } = interleaveComments(diffLines, comments, 'c1');

    const highlightedDiffLines = lines.filter(
      (l) => l.type === 'diff' && l.highlighted
    );
    expect(highlightedDiffLines).toHaveLength(3);
  });

  it('does not highlight when the selected comment is out-of-diff', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const comments = [makeComment({ id: 'c1', lineStart: 99, lineEnd: 99 })];

    const { lines } = interleaveComments(diffLines, comments, 'c1');

    const highlightedDiffLines = lines.filter(
      (l) => l.type === 'diff' && l.highlighted
    );
    expect(highlightedDiffLines).toHaveLength(0);
  });
});

// ── computeRemoteInsertionMap (unchanged) ──────────────────────────

describe('computeRemoteInsertionMap', () => {
  it('puts threads with null lineEnd in outOfDiff (general comments)', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const threads = [
      makeRemoteThread({
        id: 't1',
        file: null,
        lineStart: null,
        lineEnd: null,
      }),
    ];
    const map = computeRemoteInsertionMap(diffLines, threads);

    expect(map.insertions.size).toBe(0);
    expect(map.outOfDiff).toHaveLength(1);
    expect(map.outOfDiff[0].id).toBe('t1');
  });

  it('maps RIGHT-side threads by newLine', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    const threads = [
      makeRemoteThread({ id: 't1', lineStart: 2, lineEnd: 2, side: 'RIGHT' }),
    ];
    const map = computeRemoteInsertionMap(diffLines, threads);

    expect(map.insertions.get(1)).toHaveLength(1);
    expect(map.outOfDiff).toHaveLength(0);
  });

  it('groups multiple threads on the same line', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 5 }]);
    const threads = [
      makeRemoteThread({ id: 't1', lineStart: 5, lineEnd: 5 }),
      makeRemoteThread({ id: 't2', lineStart: 5, lineEnd: 5 }),
    ];
    const map = computeRemoteInsertionMap(diffLines, threads);

    expect(map.insertions.get(0)).toHaveLength(2);
  });
});
