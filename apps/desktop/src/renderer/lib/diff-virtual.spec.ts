import { describe, expect, it } from 'vitest';
import type { DiffLine } from '@kirby/diff';
import type {
  RemoteCommentThread,
  ReviewComment,
} from '../../host/contract.js';
import { buildFlatDiff } from './diff-virtual.js';

function ctx(oldLine: number, newLine: number): DiffLine {
  return { type: 'context', content: `line ${newLine}`, oldLine, newLine };
}
function add(newLine: number): DiffLine {
  return { type: 'add', content: `added ${newLine}`, newLine };
}

function thread(id: string, line: number | null): RemoteCommentThread {
  return {
    id,
    file: 'a.ts',
    lineStart: line,
    lineEnd: line,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [],
  } as unknown as RemoteCommentThread;
}

function draft(id: string, line: number): ReviewComment {
  return {
    id,
    file: 'a.ts',
    lineStart: line,
    lineEnd: line,
    side: 'RIGHT',
    severity: 'minor',
    body: 'x',
    status: 'draft',
    createdAt: new Date().toISOString(),
  } as unknown as ReviewComment;
}

const smallFile: DiffLine[] = [ctx(1, 1), add(2), ctx(2, 3)];

function options(over: Partial<Parameters<typeof buildFlatDiff>[1]> = {}) {
  return {
    view: 'unified' as const,
    hideResolved: false,
    hasConversation: false,
    generalThreads: [],
    threadsByFile: new Map(),
    draftsByFile: new Map(),
    fileState: new Map(),
    ...over,
  };
}

describe('buildFlatDiff', () => {
  it('flattens a file into header + unified rows', () => {
    const flat = buildFlatDiff([['a.ts', smallFile]], options());
    expect(flat.rows.map((r) => r.kind)).toEqual([
      'file-header',
      'unified',
      'unified',
      'unified',
    ]);
    expect(flat.fileIndex.get('a.ts')).toBe(0);
    expect(flat.stats.get('a.ts')).toMatchObject({ adds: 1, dels: 0 });
  });

  it('places comment rows under their anchor and maps ids to indices', () => {
    const flat = buildFlatDiff(
      [['a.ts', smallFile]],
      options({
        threadsByFile: new Map([['a.ts', [thread('t1', 2)]]]),
        draftsByFile: new Map([['a.ts', [draft('d1', 3)]]]),
      })
    );
    const kinds = flat.rows.map((r) => r.kind);
    expect(kinds).toEqual([
      'file-header',
      'unified',
      'unified', // added line 2
      'comments', // t1 under it
      'unified', // context line 3
      'comments', // d1 under it
    ]);
    expect(flat.indexById.get('t1')).toBe(3);
    expect(flat.indexById.get('d1')).toBe(5);
  });

  it('sends comments with no anchor in the diff to the orphans row', () => {
    const flat = buildFlatDiff(
      [['a.ts', smallFile]],
      options({
        threadsByFile: new Map([['a.ts', [thread('gone', 999)]]]),
      })
    );
    const orphanIndex = flat.rows.findIndex((r) => r.kind === 'orphans');
    expect(orphanIndex).toBeGreaterThan(0);
    expect(flat.indexById.get('gone')).toBe(orphanIndex);
  });

  it('renders only the header for a collapsed file', () => {
    const flat = buildFlatDiff(
      [['a.ts', smallFile]],
      options({ fileState: new Map([['a.ts', { open: false }]]) })
    );
    expect(flat.rows.map((r) => r.kind)).toEqual(['file-header']);
    expect(flat.stats.get('a.ts')?.open).toBe(false);
  });

  it('collapses lockfiles by default', () => {
    const flat = buildFlatDiff([['package-lock.json', smallFile]], options());
    expect(flat.rows.map((r) => r.kind)).toEqual(['file-header']);
    expect(flat.stats.get('package-lock.json')?.collapseReason).toBe(
      'lockfile'
    );
  });

  it('prepends a conversation row and maps general thread ids to it', () => {
    const general = [thread('g1', null)];
    const flat = buildFlatDiff(
      [['a.ts', smallFile]],
      options({ hasConversation: true, generalThreads: general })
    );
    expect(flat.rows[0]).toMatchObject({ kind: 'conversation' });
    expect(flat.indexById.get('g1')).toBe(0);
    expect(flat.fileIndex.get('a.ts')).toBe(1);
  });

  it('builds split pairs in split view', () => {
    const lines: DiffLine[] = [
      ctx(1, 1),
      { type: 'remove', content: 'old', oldLine: 2 },
      add(2),
      ctx(3, 3),
    ];
    const flat = buildFlatDiff([['a.ts', lines]], options({ view: 'split' }));
    expect(flat.rows.map((r) => r.kind)).toEqual([
      'file-header',
      'split-context',
      'split-pair',
      'split-context',
    ]);
  });

  it('hides resolved threads when hideResolved is set', () => {
    const resolved = { ...thread('r1', 2), isResolved: true };
    const flat = buildFlatDiff(
      [['a.ts', smallFile]],
      options({
        hideResolved: true,
        threadsByFile: new Map([['a.ts', [resolved]]]),
      })
    );
    expect(flat.rows.every((r) => r.kind !== 'comments')).toBe(true);
    expect(flat.indexById.has('r1')).toBe(false);
  });
});
