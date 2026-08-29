import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../host/contract.js';
import {
  buildCommentRows,
  compareCommentRows,
  navIndexOf,
  stepComment,
  visibleComments,
  type CommentRow,
} from './review-model.js';

/**
 * Property tests for the comment list, alongside the worked cases in
 * review-model.spec.ts.
 *
 * The list is a merge of three sources that the rail and the diff
 * toolbar both walk. The failures that matter are the ones no single
 * example catches: a comment that appears twice, one that disappears,
 * an order that is not an order, a "next" that lands outside the list.
 */

// ── Generators ───────────────────────────────────────────────────

const FILES = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/gone.ts'];

/** The diffed files, in some order, possibly not covering every file a
 *  comment points at — `src/gone.ts` is often left out on purpose. */
const diffFiles = fc
  .uniqueArray(fc.constantFrom(...FILES), { maxLength: 4 })
  .map((names): [string, DiffLine[]][] => names.map((n) => [n, []]));

const threadOn = (file: string | null) =>
  fc
    .record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      lineStart: fc.option(fc.integer({ min: 1, max: 200 }), { nil: null }),
      isResolved: fc.boolean(),
    })
    .map(
      (t): RemoteCommentThread =>
        ({
          ...t,
          file,
          lineEnd: t.lineStart,
          side: 'RIGHT',
          isOutdated: false,
          canResolve: true,
          comments: [
            {
              id: `${t.id}-c`,
              author: 'ada',
              body: 'b',
              createdAt: '2024-01-01T00:00:00Z',
            },
          ],
        } as RemoteCommentThread)
    );

const generals = fc.array(threadOn(null), { maxLength: 5 });
const inlines = fc.array(
  fc.constantFrom(...FILES).chain((f) => threadOn(f)),
  { maxLength: 8 }
);
const drafts = fc
  .array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      file: fc.constantFrom(...FILES),
      lineStart: fc.integer({ min: 1, max: 200 }),
      severity: fc.constantFrom('critical', 'major', 'minor', 'nit'),
    }),
    { maxLength: 8 }
  )
  .map((ds) =>
    ds.map(
      (d): ReviewComment => ({
        ...d,
        lineEnd: d.lineStart,
        body: 'draft',
        side: 'RIGHT',
        status: 'draft',
        createdAt: '2024-01-01T00:00:00Z',
      })
    )
  );

const inputs = fc.record({
  files: diffFiles,
  general: generals,
  inline: inlines,
  draft: drafts,
});

/** `Array.findLastIndex` is newer than this project's lib target. */
function lastIndexWhere<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  for (let i = xs.length - 1; i >= 0; i--) if (pred(xs[i])) return i;
  return -1;
}

// ── Coverage: nothing is lost, nothing is duplicated ─────────────

describe('buildCommentRows covers its inputs', () => {
  it('emits exactly one row per input comment', () => {
    fc.assert(
      fc.property(inputs, ({ files, general, inline, draft }) => {
        const rows = buildCommentRows(files, general, inline, draft);
        expect(rows.length).toBe(general.length + inline.length + draft.length);
      })
    );
  });

  it('emits every input id, with the right kind and the right count', () => {
    fc.assert(
      fc.property(inputs, ({ files, general, inline, draft }) => {
        const rows = buildCommentRows(files, general, inline, draft);
        const tally = (xs: { id: string }[]) => {
          const m = new Map<string, number>();
          for (const x of xs) m.set(x.id, (m.get(x.id) ?? 0) + 1);
          return m;
        };
        expect(tally(rows.filter((r) => r.kind === 'thread'))).toEqual(
          tally([...general, ...inline])
        );
        expect(tally(rows.filter((r) => r.kind === 'draft'))).toEqual(
          tally(draft)
        );
      })
    );
  });
});

// ── Order ────────────────────────────────────────────────────────

describe('buildCommentRows order', () => {
  it('is sorted by its own comparator, adjacent pair by adjacent pair', () => {
    fc.assert(
      fc.property(inputs, ({ files, general, inline, draft }) => {
        const rows = buildCommentRows(files, general, inline, draft);
        for (let i = 1; i < rows.length; i++) {
          expect(compareCommentRows(rows[i - 1], rows[i])).toBeLessThanOrEqual(
            0
          );
        }
      })
    );
  });

  it('puts every file-less row ahead of every row with a file', () => {
    fc.assert(
      fc.property(inputs, ({ files, general, inline, draft }) => {
        const rows = buildCommentRows(files, general, inline, draft);
        const lastGeneral = lastIndexWhere(rows, (r) => r.file == null);
        const firstFiled = rows.findIndex((r) => r.file != null);
        if (lastGeneral >= 0 && firstFiled >= 0)
          expect(lastGeneral).toBeLessThan(firstFiled);
      })
    );
  });

  it('never ranks a file outside the diff ahead of one inside it', () => {
    fc.assert(
      fc.property(inputs, ({ files, general, inline, draft }) => {
        const diffed = new Set(files.map(([f]) => f));
        const rows = buildCommentRows(files, general, inline, draft).filter(
          (r) => r.file != null
        );
        const lastKnown = lastIndexWhere(rows, (r) => diffed.has(r.file!));
        const firstUnknown = rows.findIndex((r) => !diffed.has(r.file!));
        if (lastKnown >= 0 && firstUnknown >= 0)
          expect(lastKnown).toBeLessThan(firstUnknown);
      })
    );
  });

  /** A comparator that is not a preorder makes the sort's output
   *  depend on the engine's algorithm rather than on the data. */
  it('compares as a total preorder: antisymmetric and transitive', () => {
    const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);
    fc.assert(
      fc.property(inputs, ({ files, general, inline, draft }) => {
        const rows = buildCommentRows(files, general, inline, draft);
        for (const a of rows)
          for (const b of rows) {
            expect(sign(compareCommentRows(a, b))).toBe(
              sign(-compareCommentRows(b, a))
            );
            for (const c of rows) {
              if (
                compareCommentRows(a, b) <= 0 &&
                compareCommentRows(b, c) <= 0
              )
                expect(compareCommentRows(a, c)).toBeLessThanOrEqual(0);
            }
          }
      })
    );
  });
});

// ── Navigation ───────────────────────────────────────────────────

const rowList = fc
  .array(
    fc.record({ id: fc.string({ minLength: 1 }), resolved: fc.boolean() }),
    { minLength: 1, maxLength: 12 }
  )
  .map((xs) =>
    xs.map(
      (x, i): CommentRow => ({
        id: `${x.id}#${i}`,
        kind: 'thread',
        author: 'a',
        where: 'w',
        preview: 'p',
        resolved: x.resolved,
        file: 'src/a.ts',
        line: i,
        fileRank: 0,
      })
    )
  );

describe('stepComment stays inside the list', () => {
  it('always lands on a member of the list it was handed', () => {
    fc.assert(
      fc.property(
        rowList,
        fc.integer({ min: -1, max: 20 }),
        fc.constantFrom(-1, 1),
        (list, rawIndex, delta) => {
          const index = rawIndex < list.length ? rawIndex : -1;
          const target = stepComment(list, index, delta);
          expect(target).not.toBeNull();
          expect(list).toContain(target);
        }
      )
    );
  });

  /** Walking the whole list with "next" visits every row exactly once
   *  and comes back where it started — the wrap has no gap and no
   *  double-count. */
  it('cycles through every row and returns to the start', () => {
    fc.assert(
      fc.property(rowList, (list) => {
        const seen: string[] = [];
        let index = 0;
        let remaining = list.length;
        while (remaining-- > 0) {
          const target = stepComment(list, index, 1)!;
          seen.push(target.id);
          index = navIndexOf(list, target.id);
        }
        expect(new Set(seen).size).toBe(list.length);
        expect(index).toBe(0);
      })
    );
  });

  /** Whatever the toolbar can reach is on screen: with hide-resolved
   *  on, no step can reach a resolved comment. */
  it('cannot reach a hidden comment once resolved ones are filtered', () => {
    fc.assert(
      fc.property(
        rowList,
        fc.integer({ min: -1, max: 20 }),
        fc.constantFrom(-1, 1),
        (list, rawIndex, delta) => {
          const visible = visibleComments(list, true);
          if (visible.length === 0) {
            expect(stepComment(visible, -1, delta)).toBeNull();
            return;
          }
          const index = rawIndex < visible.length ? rawIndex : -1;
          expect(stepComment(visible, index, delta)!.resolved).toBe(false);
        }
      )
    );
  });
});
