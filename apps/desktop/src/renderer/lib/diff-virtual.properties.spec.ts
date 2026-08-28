import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../host/contract.js';
import { buildFlatDiff, type FlatRow } from './diff-virtual.js';

/**
 * Property tests for the flattener, alongside the worked examples in
 * diff-virtual.spec.ts.
 *
 * The example tests cover the shapes we thought of. The bug that
 * actually shipped was one we hadn't: a LEFT-side comment on a context
 * line counted as anchored (so it never reached the orphan tail) while
 * no row ever emitted it, and it vanished from the viewer entirely.
 * That is an invariant violation, not a missing example — every
 * comment must come out exactly once, whatever the diff looks like.
 */

// ── Generators ───────────────────────────────────────────────────

/**
 * A diff with consistent line numbering: context lines carry both an
 * old and a new number, additions only a new one, removals only an old
 * one. Real `git diff` output is always numbered this way, and the
 * anchoring logic reads those numbers.
 */
const diffLines = fc
  .array(fc.constantFrom('context', 'add', 'remove'), {
    minLength: 1,
    maxLength: 40,
  })
  .map((kinds) => {
    const lines: DiffLine[] = [];
    let oldLine = 1;
    let newLine = 1;
    for (const kind of kinds) {
      if (kind === 'context') {
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

const side = fc.constantFrom<'LEFT' | 'RIGHT'>('LEFT', 'RIGHT');

function threadsFor(lines: DiffLine[]) {
  return fc.array(
    fc.record({
      // Deliberately unconstrained: a comment can point at a line the
      // diff does not contain (an outdated thread), which is what the
      // orphan tail exists for.
      line: fc.integer({ min: 1, max: Math.max(lines.length, 1) + 3 }),
      side,
    }),
    { maxLength: 6 }
  );
}

function makeThread(id: string, line: number, s: 'LEFT' | 'RIGHT') {
  return {
    id,
    file: 'a.ts',
    lineStart: line,
    lineEnd: line,
    side: s,
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [],
  } as unknown as RemoteCommentThread;
}

function makeDraft(id: string, line: number, s: 'LEFT' | 'RIGHT') {
  return {
    id,
    file: 'a.ts',
    lineStart: line,
    lineEnd: line,
    side: s,
    severity: 'minor',
    body: 'x',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
  } as unknown as ReviewComment;
}

/** A whole scenario: a file, its comments, and a view mode. */
const scenario = diffLines.chain((lines) =>
  fc.record({
    lines: fc.constant(lines),
    threads: threadsFor(lines),
    drafts: threadsFor(lines),
    view: fc.constantFrom<'unified' | 'split'>('unified', 'split'),
  })
);

function build(s: {
  lines: DiffLine[];
  threads: { line: number; side: 'LEFT' | 'RIGHT' }[];
  drafts: { line: number; side: 'LEFT' | 'RIGHT' }[];
  view: 'unified' | 'split';
}) {
  const threads = s.threads.map((t, i) => makeThread(`t${i}`, t.line, t.side));
  const drafts = s.drafts.map((d, i) => makeDraft(`d${i}`, d.line, d.side));
  return {
    ids: [...threads, ...drafts].map((x) => x.id),
    flat: buildFlatDiff([['a.ts', s.lines]], {
      view: s.view,
      hideResolved: false,
      hasConversation: false,
      generalThreads: [],
      threadsByFile: new Map([['a.ts', threads]]),
      draftsByFile: new Map([['a.ts', drafts]]),
      fileState: new Map([['a.ts', { open: true }]]),
    }),
  };
}

/** Every comment/draft id actually emitted in a row. */
function emittedIds(rows: FlatRow[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.kind === 'comments' || row.kind === 'orphans') {
      for (const t of row.threads) out.push(t.id);
      for (const d of row.drafts) out.push(d.id);
    }
  }
  return out;
}

// ── Properties ───────────────────────────────────────────────────

describe('buildFlatDiff invariants', () => {
  it('emits every comment exactly once', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { ids, flat } = build(s);
        const emitted = emittedIds(flat.rows);
        // The shipped bug: a comment counted as anchored but never
        // emitted, so it disappeared from the viewer with no trace.
        expect([...emitted].sort()).toEqual([...ids].sort());
      }),
      { numRuns: 300 }
    );
  });

  it('indexes every comment to the row that actually contains it', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { ids, flat } = build(s);
        for (const id of ids) {
          const index = flat.indexById.get(id);
          // Comment navigation scrolls to this index; a wrong one jumps
          // the viewer somewhere arbitrary.
          expect(index, `no index for ${id}`).toBeTypeOf('number');
          const row = flat.rows[index as number];
          expect(row.kind === 'comments' || row.kind === 'orphans').toBe(true);
          const inRow = [
            ...(row as { threads: { id: string }[] }).threads,
            ...(row as { drafts: { id: string }[] }).drafts,
          ].map((x) => x.id);
          expect(inRow).toContain(id);
        }
      }),
      { numRuns: 300 }
    );
  });

  it('never emits an empty comment row', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        for (const row of build(s).flat.rows) {
          if (row.kind !== 'comments' && row.kind !== 'orphans') continue;
          // An empty card is a gap in the diff with nothing in it.
          expect(row.threads.length + row.drafts.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('gives every row a key unique within the file', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const keys = build(s).flat.rows.map((r) => r.key);
        // React reuses DOM nodes by key; duplicates render the wrong
        // row's content in a virtualized list.
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 200 }
    );
  });

  it('keeps the file header first and its stats consistent', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { flat } = build(s);
        expect(flat.rows[0].kind).toBe('file-header');
        expect(flat.fileIndex.get('a.ts')).toBe(0);

        const stats = flat.stats.get('a.ts');
        expect(stats).toBeDefined();
        expect(stats?.adds).toBe(
          s.lines.filter((l) => l.type === 'add').length
        );
        expect(stats?.dels).toBe(
          s.lines.filter((l) => l.type === 'remove').length
        );
      }),
      { numRuns: 200 }
    );
  });

  it('places the orphan tail last when there is one', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const rows = build(s).flat.rows;
        const orphanAt = rows.findIndex((r) => r.kind === 'orphans');
        if (orphanAt === -1) return;
        // "Comments on lines not in the diff" belongs after the code,
        // not interleaved with it.
        expect(orphanAt).toBe(rows.length - 1);
      }),
      { numRuns: 200 }
    );
  });

  it('emits the same comments in split view as in unified', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const unified = emittedIds(build({ ...s, view: 'unified' }).flat.rows);
        const split = emittedIds(build({ ...s, view: 'split' }).flat.rows);
        // Switching view is a layout choice; it must not hide a comment.
        expect([...split].sort()).toEqual([...unified].sort());
      }),
      { numRuns: 200 }
    );
  });
});
