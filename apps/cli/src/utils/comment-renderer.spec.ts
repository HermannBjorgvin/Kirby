import { describe, it, expect } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import type { ReviewComment } from '../types.js';
import {
  computeInsertionMap,
  getCommentPositions,
  interleaveComments,
} from './comment-renderer.js';

function makeDiffLines(
  specs: { oldLine?: number; newLine?: number }[]
): DiffLine[] {
  return specs.map((s) => ({
    type: 'context' as const,
    content: 'x',
    oldLine: s.oldLine ?? null,
    newLine: s.newLine ?? null,
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

  it('maps LEFT-side comments by oldLine', () => {
    const diffLines = makeDiffLines([
      { oldLine: 10, newLine: 1 },
      { oldLine: 11, newLine: 2 },
    ]);
    const comments = [
      makeComment({ id: 'c1', lineStart: 10, lineEnd: 10, side: 'LEFT' }),
    ];
    const map = computeInsertionMap(diffLines, comments);

    expect(map.insertions.get(0)).toHaveLength(1);
    expect(map.outOfDiff).toHaveLength(0);
  });

  it('puts out-of-diff comments in outOfDiff when no lines match', () => {
    // Use empty diffLines so there's no closest line to fall back to
    const diffLines: DiffLine[] = [];
    const comments = [makeComment({ id: 'c1', lineStart: 999, lineEnd: 999 })];
    const map = computeInsertionMap(diffLines, comments);

    expect(map.insertions.size).toBe(0);
    expect(map.outOfDiff).toHaveLength(1);
  });

  it('falls back to closest line when exact match not found', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
    ]);
    // lineEnd=999 not in diff, but closest line <= 999 is newLine=2 at index 1
    const comments = [makeComment({ id: 'c1', lineStart: 999, lineEnd: 999 })];
    const map = computeInsertionMap(diffLines, comments);

    expect(map.insertions.get(1)).toHaveLength(1);
    expect(map.outOfDiff).toHaveLength(0);
  });

  it('groups multiple comments on the same line', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 5 }]);
    const comments = [
      makeComment({ id: 'c1', lineStart: 5, lineEnd: 5 }),
      makeComment({ id: 'c2', lineStart: 5, lineEnd: 5 }),
    ];
    const map = computeInsertionMap(diffLines, comments);

    expect(map.insertions.get(0)).toHaveLength(2);
  });
});

describe('getCommentPositions', () => {
  it('returns correct headerLine from annotated lines', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
      { oldLine: 3, newLine: 3 },
    ]);
    const rendered = ['line1', 'line2', 'line3'];
    const comments = [makeComment({ id: 'c1', lineStart: 2, lineEnd: 2 })];

    const result = interleaveComments(diffLines, rendered, comments, 80, null);
    const positions = getCommentPositions(
      result.lines,
      result.insertionMap,
      comments
    );

    expect(positions.has('c1')).toBe(true);
    const info = positions.get('c1')!;
    // Header should be right after diff line index 1 (second line)
    expect(info.headerLine).toBe(2);
  });

  it('computes different positions for selected vs unselected comments', () => {
    const diffLines = makeDiffLines([
      { oldLine: 1, newLine: 1 },
      { oldLine: 2, newLine: 2 },
      { oldLine: 3, newLine: 3 },
    ]);
    const rendered = ['line1', 'line2', 'line3'];
    const longBody = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join(
      '\n'
    );
    const comments = [
      makeComment({ id: 'c1', lineStart: 1, lineEnd: 1, body: longBody }),
      makeComment({ id: 'c2', lineStart: 3, lineEnd: 3 }),
    ];

    const unselected = interleaveComments(
      diffLines,
      rendered,
      comments,
      80,
      null
    );
    const selected = interleaveComments(
      diffLines,
      rendered,
      comments,
      80,
      'c1'
    );

    const posUnsel = getCommentPositions(
      unselected.lines,
      unselected.insertionMap,
      comments
    );
    const posSel = getCommentPositions(
      selected.lines,
      selected.insertionMap,
      comments
    );

    // c2 should be at a different position when c1 is expanded vs collapsed
    expect(posSel.get('c2')!.headerLine).toBeGreaterThan(
      posUnsel.get('c2')!.headerLine
    );
  });
});

const BG_HIGHLIGHT = '\x1b[48;5;58m';

// Simulate the real diff renderer gutter: "   1:   1  content" (13+ visible chars)
function renderWithGutter(lineNum: number, content: string): string {
  const old = String(lineNum).padStart(4);
  const nw = String(lineNum).padStart(4);
  return `${old}:${nw}  ${content}`;
}

describe('interleaveComments highlighting', () => {
  it('highlights referenced lines with BG_HIGHLIGHT when comment is selected', () => {
    const diffLines = makeDiffLines(
      Array.from({ length: 10 }, (_, i) => ({
        oldLine: i + 1,
        newLine: i + 1,
      }))
    );
    const rendered = diffLines.map((_, i) =>
      renderWithGutter(i + 1, `line ${i + 1}`)
    );
    const comments = [makeComment({ id: 'c1', lineStart: 3, lineEnd: 5 })];

    const { lines: annotated } = interleaveComments(
      diffLines,
      rendered,
      comments,
      80,
      'c1' // selected
    );

    const highlightedDiffLines = annotated.filter(
      (l) => l.type === 'diff' && l.rendered.includes(BG_HIGHLIGHT)
    );
    expect(highlightedDiffLines).toHaveLength(3);
    // Verify they are the correct lines (3, 4, 5) — strip ANSI to check content
    // since the BG_HIGHLIGHT may be inserted mid-text at the gutter boundary.
    // eslint-disable-next-line no-control-regex
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    expect(strip(highlightedDiffLines[0].rendered)).toContain('line 3');
    expect(strip(highlightedDiffLines[1].rendered)).toContain('line 4');
    expect(strip(highlightedDiffLines[2].rendered)).toContain('line 5');
  });

  it('does not highlight when referenced lines are absent from diff', () => {
    const diffLines = makeDiffLines(
      Array.from({ length: 5 }, (_, i) => ({
        oldLine: i + 1,
        newLine: i + 1,
      }))
    );
    const rendered = diffLines.map((_, i) =>
      renderWithGutter(i + 1, `line ${i + 1}`)
    );
    const comments = [makeComment({ id: 'c1', lineStart: 107, lineEnd: 116 })];

    const { lines: annotated } = interleaveComments(
      diffLines,
      rendered,
      comments,
      80,
      'c1'
    );

    const highlightedDiffLines = annotated.filter(
      (l) => l.type === 'diff' && l.rendered.includes(BG_HIGHLIGHT)
    );
    expect(highlightedDiffLines).toHaveLength(0);
  });
});

describe('renderCommentBlock posting status', () => {
  it('shows ⏳ indicator for posting status', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const rendered = ['line1'];
    const comments = [
      makeComment({ id: 'c1', lineStart: 1, lineEnd: 1, status: 'posting' }),
    ];

    const { lines: annotated } = interleaveComments(
      diffLines,
      rendered,
      comments,
      80,
      null
    );
    const headerLine = annotated.find((l) => l.type === 'comment-header');
    expect(headerLine).toBeDefined();
    expect(headerLine!.rendered).toContain('⏳');
  });

  it('shows ✓ indicator for posted status', () => {
    const diffLines = makeDiffLines([{ oldLine: 1, newLine: 1 }]);
    const rendered = ['line1'];
    const comments = [
      makeComment({ id: 'c1', lineStart: 1, lineEnd: 1, status: 'posted' }),
    ];

    const { lines: annotated } = interleaveComments(
      diffLines,
      rendered,
      comments,
      80,
      null
    );
    const headerLine = annotated.find((l) => l.type === 'comment-header');
    expect(headerLine).toBeDefined();
    expect(headerLine!.rendered).toContain('✓');
  });
});
