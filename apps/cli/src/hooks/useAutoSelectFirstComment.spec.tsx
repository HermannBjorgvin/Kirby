import { describe, it, expect, vi } from 'vitest';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type { ReviewComment, RowMap } from '@kirby/review-comments';
import {
  useAutoSelectFirstComment,
  type UseAutoSelectFirstCommentOptions,
} from './useAutoSelectFirstComment.js';

// ── Test helpers ────────────────────────────────────────────────

function makeComment(
  overrides: Partial<ReviewComment> & { id: string }
): ReviewComment {
  return {
    file: 'foo.ts',
    lineStart: 10,
    lineEnd: 10,
    severity: 'minor',
    body: 'b',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRemoteThread(
  overrides: Partial<RemoteCommentThread> & { id: string }
): RemoteCommentThread {
  return {
    file: 'foo.ts',
    lineStart: 5,
    lineEnd: 5,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      { id: `${overrides.id}-c1`, author: 'a', body: 'x', createdAt: 'now' },
    ],
    ...overrides,
  };
}

function makeRowMap(
  positions: { rowStart: number; rowSpan: number }[]
): RowMap {
  return {
    totalRows: positions.reduce((acc, p) => acc + p.rowSpan, 0),
    sectionAnchorRows: [0],
    positions,
  };
}

function Probe(props: { opts: UseAutoSelectFirstCommentOptions }) {
  useAutoSelectFirstComment(props.opts);
  return <Box />;
}

// Mounts the hook with provided opts; lets the test re-render with new opts.
function mountHook(initial: UseAutoSelectFirstCommentOptions): {
  rerender: (next: UseAutoSelectFirstCommentOptions) => void;
  unmount: () => void;
} {
  const inst = render(<Probe opts={initial} />);
  return {
    rerender: (next) => inst.rerender(<Probe opts={next} />),
    unmount: inst.unmount,
  };
}

// Flush microtasks so React commits effects.
async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

// ── Tests ───────────────────────────────────────────────────────

describe('useAutoSelectFirstComment', () => {
  it('does nothing when file is null', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { unmount } = mountHook({
      file: null,
      fileComments: [makeComment({ id: 'c1' })],
      fileRemoteThreads: [],
      commentPositions: new Map([['c1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 10,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).not.toHaveBeenCalled();
    expect(setDiffScrollOffset).not.toHaveBeenCalled();
    unmount();
  });

  it('does nothing when navPool is empty (no comments or threads)', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { unmount } = mountHook({
      file: 'foo.ts',
      fileComments: [],
      fileRemoteThreads: [],
      commentPositions: new Map(),
      rowMap: makeRowMap([]),
      diffTotalRows: 0,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).not.toHaveBeenCalled();
    expect(setDiffScrollOffset).not.toHaveBeenCalled();
    unmount();
  });

  it('bails until the rowMap reflects the comment (gate on async data)', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { rerender, unmount } = mountHook({
      file: 'foo.ts',
      fileComments: [],
      fileRemoteThreads: [makeRemoteThread({ id: 't1', lineStart: 5 })],
      // rowMap not yet computed for the thread (positions empty)
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([]),
      diffTotalRows: 0,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).not.toHaveBeenCalled();

    // Now data lands — rowMap entry for refStartLine 0 exists.
    rerender({
      file: 'foo.ts',
      fileComments: [],
      fileRemoteThreads: [makeRemoteThread({ id: 't1', lineStart: 5 })],
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 5, rowSpan: 3 }]),
      diffTotalRows: 8,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).toHaveBeenCalledWith('t1');
    expect(setDiffScrollOffset).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('selects the first comment by line order', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { unmount } = mountHook({
      file: 'foo.ts',
      fileComments: [makeComment({ id: 'c-far', lineStart: 50 })],
      fileRemoteThreads: [
        makeRemoteThread({ id: 't-near', lineStart: 5 }),
        makeRemoteThread({ id: 't-mid', lineStart: 20 }),
      ],
      commentPositions: new Map([
        ['c-far', { headerLine: 2, refStartLine: 2 }],
        ['t-near', { headerLine: 0, refStartLine: 0 }],
        ['t-mid', { headerLine: 1, refStartLine: 1 }],
      ]),
      rowMap: makeRowMap([
        { rowStart: 5, rowSpan: 1 },
        { rowStart: 20, rowSpan: 1 },
        { rowStart: 50, rowSpan: 1 },
      ]),
      diffTotalRows: 60,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).toHaveBeenCalledWith('t-near');
    unmount();
  });

  it('filters posted local comments out of the nav pool', async () => {
    // A 'posted' local comment has its remote-thread twin in fileRemoteThreads;
    // including the local twin would point at a dead id with no rowMap entry,
    // and the rowEntry guard would silently bail forever for that file.
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { unmount } = mountHook({
      file: 'foo.ts',
      fileComments: [
        makeComment({ id: 'c-posted', lineStart: 1, status: 'posted' }),
      ],
      fileRemoteThreads: [makeRemoteThread({ id: 't-real', lineStart: 5 })],
      commentPositions: new Map([
        ['t-real', { headerLine: 0, refStartLine: 0 }],
        // c-posted has no rowMap entry on purpose
      ]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 10,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).toHaveBeenCalledWith('t-real');
    unmount();
  });

  it('does not re-fire within the same file after subsequent renders', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const baseOpts: UseAutoSelectFirstCommentOptions = {
      file: 'foo.ts',
      fileComments: [],
      fileRemoteThreads: [makeRemoteThread({ id: 't1' })],
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 10,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    };
    const { rerender, unmount } = mountHook(baseOpts);
    await flush();
    expect(setSelectedCommentId).toHaveBeenCalledTimes(1);

    // Re-render with new object identities but same file → must not re-fire.
    rerender({
      ...baseOpts,
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
    });
    await flush();
    expect(setSelectedCommentId).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('re-fires when the file changes', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { rerender, unmount } = mountHook({
      file: 'foo.ts',
      fileComments: [],
      fileRemoteThreads: [makeRemoteThread({ id: 't1' })],
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 10,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).toHaveBeenLastCalledWith('t1');

    rerender({
      file: 'bar.ts',
      fileComments: [],
      fileRemoteThreads: [
        makeRemoteThread({ id: 't2', file: 'bar.ts', lineStart: 12 }),
      ],
      commentPositions: new Map([['t2', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 10,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setSelectedCommentId).toHaveBeenLastCalledWith('t2');
    expect(setSelectedCommentId).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('clamps the scroll offset to maxScroll when the comment is near the end', async () => {
    const setSelectedCommentId = vi.fn();
    const setDiffScrollOffset = vi.fn();
    const { unmount } = mountHook({
      file: 'foo.ts',
      fileComments: [],
      fileRemoteThreads: [makeRemoteThread({ id: 't1' })],
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      // rowEntry.rowStart - 2 = 98; maxScroll = 100 - (10-3) = 93 → clamps to 93
      rowMap: makeRowMap([{ rowStart: 100, rowSpan: 1 }]),
      diffTotalRows: 100,
      paneRows: 10,
      setSelectedCommentId,
      setDiffScrollOffset,
    });
    await flush();
    expect(setDiffScrollOffset).toHaveBeenCalledWith(93);
    unmount();
  });
});
