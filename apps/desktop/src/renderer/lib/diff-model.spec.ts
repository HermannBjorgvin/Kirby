import { describe, it, expect } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import {
  anchorKey,
  buildSplitRows,
  buildUnifiedRows,
  defaultCollapseReason,
  expandIndices,
  orderDraftsForReview,
  severityCounts,
  snippetAround,
} from './diff-model.js';
import { wordDiff } from './word-diff.js';
import type { ReviewComment } from '../../host/contract.js';

function ctx(n: number, startOld = 1, startNew = 1): DiffLine[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'context',
    content: `line ${i}`,
    oldLine: startOld + i,
    newLine: startNew + i,
  }));
}

describe('buildUnifiedRows', () => {
  it('folds long unchanged runs and keeps context around changes', () => {
    const lines: DiffLine[] = [
      { type: 'hunk-header', content: '@@' },
      ...ctx(20, 1, 1),
      { type: 'remove', content: 'old', oldLine: 21 },
      { type: 'add', content: 'new', newLine: 21 },
      ...ctx(20, 22, 22),
    ];
    const rows = buildUnifiedRows(lines, { context: 3 });
    // header + 3 context visible, fold, 3 ctx + change + 3 ctx, fold
    const folds = rows.filter((r) => r.kind === 'fold');
    expect(folds).toHaveLength(2);
    const shown = rows.filter((r) => r.kind === 'line').length;
    expect(shown).toBe(1 + 3 + 3 + 2 + 3);
  });

  it('never folds gaps shorter than the minimum', () => {
    const lines: DiffLine[] = [
      { type: 'add', content: 'a', newLine: 1 },
      ...ctx(5, 1, 2),
      { type: 'add', content: 'b', newLine: 7 },
    ];
    // gap of 5 with context 1 leaves 3 hidden → below MIN_FOLD → shown
    const rows = buildUnifiedRows(lines, { context: 1 });
    expect(rows.every((r) => r.kind === 'line')).toBe(true);
  });

  it('keeps lines with pinned thread anchors visible', () => {
    const lines: DiffLine[] = [
      { type: 'add', content: 'a', newLine: 1 },
      ...ctx(40, 1, 2),
    ];
    const pinned = new Set([anchorKey('R', 30)]);
    const rows = buildUnifiedRows(lines, { context: 2, pinnedAnchors: pinned });
    const visibleNew = rows
      .filter((r): r is { kind: 'line'; index: number } => r.kind === 'line')
      .map((r) => lines[r.index].newLine);
    expect(visibleNew).toContain(30);
    expect(visibleNew).toContain(28);
    expect(visibleNew).not.toContain(20);
  });

  it('honours expanded indices', () => {
    const lines: DiffLine[] = [
      { type: 'add', content: 'a', newLine: 1 },
      ...ctx(40, 1, 2),
    ];
    const fold = buildUnifiedRows(lines, { context: 1 }).find(
      (r) => r.kind === 'fold'
    ) as { kind: 'fold'; from: number; to: number };
    const expanded = new Set(expandIndices(fold, 'up', 5));
    const rows = buildUnifiedRows(lines, { context: 1, expanded });
    const firstFold = rows.find((r) => r.kind === 'fold') as {
      from: number;
    };
    expect(firstFold.from).toBe(fold.from + 5);
  });
});

describe('buildSplitRows', () => {
  it('pairs removed and added runs positionally', () => {
    const lines: DiffLine[] = [
      { type: 'remove', content: 'a', oldLine: 1 },
      { type: 'remove', content: 'b', oldLine: 2 },
      { type: 'add', content: 'A', newLine: 1 },
      { type: 'context', content: 'c', oldLine: 3, newLine: 2 },
    ];
    const rows = buildSplitRows(
      lines,
      buildUnifiedRows(lines, { noFold: true })
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      kind: 'pair',
      left: { index: 0 },
      right: { index: 2 },
    });
    expect(rows[1]).toMatchObject({
      kind: 'pair',
      left: { index: 1 },
      right: null,
    });
    expect(rows[2]).toMatchObject({ kind: 'context', index: 3 });
  });
});

describe('wordDiff', () => {
  it('highlights only the changed tokens', () => {
    const d = wordDiff('const foo = 1;', 'const bar = 1;');
    expect(d).not.toBeNull();
    expect(d!.old).toEqual([{ start: 6, end: 9 }]);
    expect(d!.new).toEqual([{ start: 6, end: 9 }]);
  });

  it('bails when lines are mostly different', () => {
    expect(wordDiff('alpha beta gamma', 'x y z w')).toBeNull();
  });
});

describe('defaultCollapseReason', () => {
  it('collapses lockfiles, generated output and huge diffs', () => {
    expect(defaultCollapseReason('package-lock.json', 10)).toBe('lockfile');
    expect(defaultCollapseReason('dist/app.js', 10)).toBe('generated');
    expect(defaultCollapseReason('src/a.ts', 5000)).toBe('large');
    expect(defaultCollapseReason('src/a.ts', 10)).toBeNull();
  });
});

function draft(p: Partial<ReviewComment>): ReviewComment {
  return {
    id: p.id ?? 'x',
    file: p.file ?? 'a.ts',
    lineStart: p.lineStart ?? 1,
    lineEnd: p.lineEnd ?? p.lineStart ?? 1,
    severity: p.severity ?? 'minor',
    body: p.body ?? '',
    side: p.side ?? 'RIGHT',
    status: p.status ?? 'draft',
    createdAt: p.createdAt ?? '2026-01-01T00:00:00Z',
  };
}

describe('orderDraftsForReview', () => {
  it('orders by severity, then file order, then line', () => {
    const order = new Map([
      ['a.ts', 0],
      ['b.ts', 1],
    ]);
    const drafts = [
      draft({ id: 'nit', severity: 'nit', file: 'a.ts', lineStart: 1 }),
      draft({ id: 'crit-b', severity: 'critical', file: 'b.ts', lineStart: 5 }),
      draft({
        id: 'crit-a2',
        severity: 'critical',
        file: 'a.ts',
        lineStart: 9,
      }),
      draft({
        id: 'crit-a1',
        severity: 'critical',
        file: 'a.ts',
        lineStart: 2,
      }),
    ];
    expect(orderDraftsForReview(drafts, order).map((d) => d.id)).toEqual([
      'crit-a1',
      'crit-a2',
      'crit-b',
      'nit',
    ]);
  });
});

describe('severityCounts', () => {
  it('tallies each severity', () => {
    const counts = severityCounts([
      draft({ severity: 'critical' }),
      draft({ severity: 'critical' }),
      draft({ severity: 'nit' }),
    ]);
    expect(counts).toEqual({ critical: 2, major: 0, minor: 0, nit: 1 });
  });
});

describe('snippetAround', () => {
  const lines: DiffLine[] = [
    { type: 'context', content: 'a', oldLine: 1, newLine: 1 },
    { type: 'context', content: 'b', oldLine: 2, newLine: 2 },
    { type: 'add', content: 'c', newLine: 3 },
    { type: 'add', content: 'd', newLine: 4 },
    { type: 'context', content: 'e', oldLine: 3, newLine: 5 },
  ];
  it('windows around the RIGHT anchor and flags anchored rows', () => {
    const snip = snippetAround(lines, 'RIGHT', 3, 4, 1);
    expect(snip.map((s) => s.line.content)).toEqual(['b', 'c', 'd', 'e']);
    expect(snip.map((s) => s.anchored)).toEqual([false, true, true, false]);
  });
  it('returns empty when the anchor is not present', () => {
    expect(snippetAround(lines, 'RIGHT', 99, 99)).toEqual([]);
  });
});
