import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import {
  anchorKey,
  buildSplitRows,
  buildUnifiedRows,
  expandIndices,
  type SplitRow,
  type UnifiedRow,
} from './diff-model.js';
import { wordDiff } from './word-diff.js';

/**
 * Property tests for the diff layout, alongside the worked cases in
 * diff-model.spec.ts.
 *
 * Folding hides code the reviewer did not ask to hide, and split view
 * re-arranges it. Both are easy to get subtly wrong in a way no single
 * example catches: a line that appears twice, a line that disappears
 * between the two views, a fold that swallows a changed line. Those are
 * coverage properties, so that is how they are tested.
 */

// ── Generators ───────────────────────────────────────────────────

const lineKind = fc.constantFrom(
  'context',
  'context',
  'context',
  'add',
  'remove',
  'hunk-header'
);

/** A consistently numbered diff, the way git emits one. */
const diffLines = fc
  .array(lineKind, { minLength: 1, maxLength: 60 })
  .map((kinds) => {
    const lines: DiffLine[] = [];
    let oldLine = 1;
    let newLine = 1;
    for (const kind of kinds) {
      if (kind === 'hunk-header') {
        lines.push({ type: 'hunk-header', content: '@@ -1 +1 @@' } as DiffLine);
      } else if (kind === 'context') {
        lines.push({
          type: 'context',
          content: `ctx ${newLine}`,
          oldLine: oldLine++,
          newLine: newLine++,
        });
      } else if (kind === 'add') {
        lines.push({
          type: 'add',
          content: `add ${newLine}`,
          newLine: newLine++,
        });
      } else {
        lines.push({
          type: 'remove',
          content: `del ${oldLine}`,
          oldLine: oldLine++,
        });
      }
    }
    return lines;
  });

/** Which line indices a unified row list actually shows. */
function shown(rows: readonly UnifiedRow[]): number[] {
  return rows.flatMap((r) => (r.kind === 'line' ? [r.index] : []));
}

/** Which indices a fold hides. */
function folded(rows: readonly UnifiedRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    if (r.kind !== 'fold') continue;
    for (let i = r.from; i < r.to; i++) out.push(i);
  }
  return out;
}

describe('buildUnifiedRows', () => {
  it('accounts for every line exactly once, shown or folded', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const rows = buildUnifiedRows(lines);
        const all = [...shown(rows), ...folded(rows)].sort((a, b) => a - b);
        // A line that is neither shown nor inside a fold is simply
        // missing from the viewer, with nothing to click to get it back.
        expect(all).toEqual(lines.map((_, i) => i));
      }),
      { numRuns: 300 }
    );
  });

  it('keeps rows in file order', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const rows = buildUnifiedRows(lines);
        const starts = rows.map((r) => (r.kind === 'line' ? r.index : r.from));
        expect([...starts].sort((a, b) => a - b)).toEqual(starts);
      }),
      { numRuns: 300 }
    );
  });

  it('never folds a changed line or a hunk header', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        for (const i of folded(buildUnifiedRows(lines))) {
          // Folding the actual change away is the one thing the fold
          // must never do.
          expect(lines[i].type).toBe('context');
        }
      }),
      { numRuns: 300 }
    );
  });

  it('shows everything when folding is off', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const rows = buildUnifiedRows(lines, { noFold: true });
        expect(shown(rows)).toEqual(lines.map((_, i) => i));
        expect(folded(rows)).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it('shows a pinned line rather than folding a comment out of sight', () => {
    fc.assert(
      fc.property(
        diffLines.chain((lines) =>
          fc.record({
            lines: fc.constant(lines),
            index: fc.integer({ min: 0, max: lines.length - 1 }),
          })
        ),
        ({ lines, index }) => {
          const line = lines[index];
          if (line.type !== 'context' || line.newLine == null) return;
          const rows = buildUnifiedRows(lines, {
            pinnedAnchors: new Set([anchorKey('R', line.newLine)]),
          });
          // A thread anchored here has to be reachable; folding it away
          // hides the comment with it.
          expect(shown(rows)).toContain(index);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('shows an expanded line', () => {
    fc.assert(
      fc.property(
        diffLines.chain((lines) =>
          fc.record({
            lines: fc.constant(lines),
            index: fc.integer({ min: 0, max: lines.length - 1 }),
          })
        ),
        ({ lines, index }) => {
          const rows = buildUnifiedRows(lines, { expanded: new Set([index]) });
          expect(shown(rows)).toContain(index);
        }
      ),
      { numRuns: 300 }
    );
  });

  it('reveals strictly more as the context grows', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const tight = new Set(shown(buildUnifiedRows(lines, { context: 1 })));
        const loose = shown(buildUnifiedRows(lines, { context: 5 }));
        // More context can only add lines, never take one away.
        for (const i of tight) expect(loose).toContain(i);
      }),
      { numRuns: 200 }
    );
  });
});

describe('expandIndices', () => {
  const fold = fc
    .tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 1, max: 40 }))
    .map(([from, len]) => ({ from, to: from + len }));

  it('stays inside the gap it was asked to expand', () => {
    fc.assert(
      fc.property(
        fold,
        fc.constantFrom<'up' | 'down' | 'all'>('up', 'down', 'all'),
        fc.integer({ min: 1, max: 60 }),
        (f, direction, step) => {
          for (const i of expandIndices(f, direction, step)) {
            // Expanding past the gap would reveal lines that are
            // already on screen, duplicating them.
            expect(i).toBeGreaterThanOrEqual(f.from);
            expect(i).toBeLessThan(f.to);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('always reveals something, and reveals all of a small gap', () => {
    fc.assert(
      fc.property(
        fold,
        fc.constantFrom<'up' | 'down' | 'all'>('up', 'down', 'all'),
        fc.integer({ min: 1, max: 60 }),
        (f, direction, step) => {
          const out = expandIndices(f, direction, step);
          // A click that reveals nothing looks broken.
          expect(out.length).toBeGreaterThan(0);
          const size = f.to - f.from;
          expect(out.length).toBe(
            direction === 'all' ? size : Math.min(step, size)
          );
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('buildSplitRows', () => {
  function splitIndices(rows: readonly SplitRow[]): number[] {
    const out: number[] = [];
    for (const r of rows) {
      if (r.kind === 'pair') {
        if (r.left) out.push(r.left.index);
        if (r.right) out.push(r.right.index);
      } else if (r.kind !== 'fold') {
        out.push(r.index);
      }
    }
    return out;
  }

  it('shows exactly the lines unified showed', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const unified = buildUnifiedRows(lines);
        const split = buildSplitRows(lines, unified);
        // Switching to side-by-side is a layout choice; it must not
        // drop or invent a line.
        expect(splitIndices(split).sort((a, b) => a - b)).toEqual(
          shown(unified).sort((a, b) => a - b)
        );
      }),
      { numRuns: 300 }
    );
  });

  it('puts removals only on the left and additions only on the right', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const split = buildSplitRows(lines, buildUnifiedRows(lines));
        // Gathered rather than asserted per row: an empty list is the
        // property, and a failure names the type that landed wrong.
        const misplaced = split.flatMap((r) =>
          r.kind === 'pair'
            ? [
                ...(r.left && r.left.line.type !== 'remove'
                  ? [`left:${r.left.line.type}`]
                  : []),
                ...(r.right && r.right.line.type !== 'add'
                  ? [`right:${r.right.line.type}`]
                  : []),
              ]
            : []
        );
        expect(misplaced).toEqual([]);
      }),
      { numRuns: 300 }
    );
  });

  it('never emits an empty pair', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const split = buildSplitRows(lines, buildUnifiedRows(lines));
        for (const r of split) {
          if (r.kind !== 'pair') continue;
          // A row with neither side renders as a blank gap.
          expect(r.left !== null || r.right !== null).toBe(true);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('passes folds through unchanged', () => {
    fc.assert(
      fc.property(diffLines, (lines) => {
        const unified = buildUnifiedRows(lines);
        const split = buildSplitRows(lines, unified);
        expect(split.filter((r) => r.kind === 'fold')).toEqual(
          unified.filter((r) => r.kind === 'fold')
        );
      }),
      { numRuns: 200 }
    );
  });
});

describe('wordDiff', () => {
  const text = fc.stringMatching(/^[a-z ().;]{0,40}$/);

  /** Text outside the highlighted ranges. */
  function complement(s: string, ranges: { start: number; end: number }[]) {
    let out = '';
    let at = 0;
    for (const r of ranges) {
      out += s.slice(at, r.start);
      at = r.end;
    }
    return out + s.slice(at);
  }

  it('bails out rather than highlighting an empty line', () => {
    // Documented bail-out: there is nothing useful to point at.
    expect(wordDiff('', '')).toBeNull();
    expect(wordDiff('abc', '')).toBeNull();
  });

  it('produces in-bounds, ordered, non-overlapping ranges', () => {
    fc.assert(
      fc.property(text, text, (before, after) => {
        const result = wordDiff(before, after);
        if (!result) return;
        for (const [s, ranges] of [
          [before, result.old],
          [after, result.new],
        ] as const) {
          let prevEnd = 0;
          for (const r of ranges) {
            expect(r.start).toBeGreaterThanOrEqual(prevEnd);
            expect(r.start).toBeLessThan(r.end);
            expect(r.end).toBeLessThanOrEqual(s.length);
            prevEnd = r.end;
          }
        }
      }),
      { numRuns: 300 }
    );
  });

  it('leaves the same text unhighlighted on both sides', () => {
    fc.assert(
      fc.property(text, text, (before, after) => {
        const result = wordDiff(before, after);
        if (!result) return;
        // The unhighlighted parts are the common subsequence, so they
        // must read identically — otherwise the highlights are pointing
        // at the wrong characters.
        expect(complement(before, result.old)).toBe(
          complement(after, result.new)
        );
      }),
      { numRuns: 300 }
    );
  });

  it('highlights nothing when the two sides are identical', () => {
    fc.assert(
      fc.property(
        text.filter((s) => s.length > 0),
        (s) => {
          const result = wordDiff(s, s);
          // Highlighting an unchanged line is noise on every line of a
          // whole-file diff.
          expect(result).toEqual({ old: [], new: [] });
        }
      ),
      { numRuns: 200 }
    );
  });
});
