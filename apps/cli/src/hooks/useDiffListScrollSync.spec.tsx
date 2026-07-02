import { describe, it, expect, vi, type Mock } from 'vitest';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type { DiffFile } from '@kirby/diff';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type {
  DiffListItem,
  DiffListLayout,
} from '../screens/reviews/diff-list-layout.js';
import {
  useDiffListScrollSync,
  type UseDiffListScrollSyncOptions,
} from './useDiffListScrollSync.js';

function fileItem(filename: string, span = 1): DiffListItem {
  const file: DiffFile = {
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    binary: false,
  };
  return { kind: 'file', file, depth: 0, dirs: [], span };
}

function commentItem(id: string, span: number, commentIndex = 0): DiffListItem {
  const thread: RemoteCommentThread = {
    id,
    file: null,
    lineStart: null,
    lineEnd: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    canResolve: true,
    comments: [
      {
        id: `${id}-c1`,
        author: 'a',
        body: 'b',
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
  return {
    kind: 'comment',
    thread,
    commentIndex,
    withHeading: commentIndex === 0,
    span,
  };
}

function makeLayout(
  items: DiffListItem[],
  viewportRows: number
): DiffListLayout {
  return {
    maxWidth: 80,
    cardWidth: 80,
    cardContentWidth: 76,
    items,
    spans: items.map((i) => i.span),
    budgetRows: viewportRows + 2,
    viewportRows,
  };
}

function Probe(props: { opts: UseDiffListScrollSyncOptions }) {
  useDiffListScrollSync(props.opts);
  return <Box />;
}

function mountHook(initial: UseDiffListScrollSyncOptions): {
  rerender: (next: UseDiffListScrollSyncOptions) => void;
  unmount: () => void;
} {
  const inst = render(<Probe opts={initial} />);
  return {
    rerender: (next) => inst.rerender(<Probe opts={next} />),
    unmount: inst.unmount,
  };
}

async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

/** Apply every recorded functional updater in call order, the way
 *  React folds queued updates into the next state. */
function foldOffset(setter: Mock, start: number): number {
  return setter.mock.calls.reduce(
    (offset, call) => (call[0] as (n: number) => number)(offset),
    start
  );
}

function baseOpts(
  overrides: Partial<UseDiffListScrollSyncOptions>
): UseDiffListScrollSyncOptions {
  return {
    layout: makeLayout([fileItem('a.ts')], 8),
    selectedIndex: 0,
    composing: false,
    pendingScrollThreadId: null,
    setDiffListScrollRow: vi.fn(),
    setPendingScrollThreadId: vi.fn(),
    ...overrides,
  };
}

describe('useDiffListScrollSync — compose visibility', () => {
  // 5 file rows then a 10-row comment card (bounds 5..15), viewport 8.
  const items = [
    ...Array.from({ length: 5 }, (_, i) => fileItem(`f${i}.ts`)),
    commentItem('t1', 10),
  ];

  it('reveals the composing item bottom when the input opens', async () => {
    const setDiffListScrollRow = vi.fn();
    const { unmount } = mountHook(
      baseOpts({
        layout: makeLayout(items, 8),
        selectedIndex: 5,
        composing: true,
        setDiffListScrollRow,
      })
    );
    await flush();
    // bottom 15 − viewport 8 = 7; total 15 → max offset 7.
    expect(foldOffset(setDiffListScrollRow, 0)).toBe(7);
    unmount();
  });

  it('keeps revealing as the buffer grows the span', async () => {
    const setDiffListScrollRow = vi.fn();
    const opts = baseOpts({
      layout: makeLayout(items, 8),
      selectedIndex: 5,
      composing: true,
      setDiffListScrollRow,
    });
    const { rerender, unmount } = mountHook(opts);
    await flush();
    const afterOpen = foldOffset(setDiffListScrollRow, 0);
    expect(afterOpen).toBe(7);

    setDiffListScrollRow.mockClear();
    // Buffer wrapped: the card grows 10 → 14 rows (bounds 5..19).
    const grown = [...items.slice(0, 5), commentItem('t1', 14)];
    rerender({ ...opts, layout: makeLayout(grown, 8) });
    await flush();
    // bottom 19 − viewport 8 = 11.
    expect(foldOffset(setDiffListScrollRow, afterOpen)).toBe(11);
    unmount();
  });

  it('does nothing when not composing', async () => {
    const setDiffListScrollRow = vi.fn();
    const { unmount } = mountHook(
      baseOpts({
        layout: makeLayout(items, 8),
        selectedIndex: 5,
        setDiffListScrollRow,
      })
    );
    await flush();
    expect(setDiffListScrollRow).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useDiffListScrollSync — scroll anchoring', () => {
  it('shifts the offset by the selected item top delta when content above grows', async () => {
    const setDiffListScrollRow = vi.fn();
    // f0 (2 rows), f1 (1 row), c:t1 (5 rows, top=3); viewport 5.
    const before = [
      fileItem('f0.ts', 2),
      fileItem('f1.ts'),
      commentItem('t1', 5),
    ];
    const opts = baseOpts({
      layout: makeLayout(before, 5),
      selectedIndex: 2,
      setDiffListScrollRow,
    });
    const { rerender, unmount } = mountHook(opts);
    await flush();
    expect(setDiffListScrollRow).not.toHaveBeenCalled();

    // f0 grows 2 → 6 rows: c:t1's top moves 3 → 7 (total 12).
    const after = [
      fileItem('f0.ts', 6),
      fileItem('f1.ts'),
      commentItem('t1', 5),
    ];
    rerender({ ...opts, layout: makeLayout(after, 5) });
    await flush();
    // offset 3 (t1 top-aligned) shifts by +4 → 7 (max offset 12−5=7).
    expect(foldOffset(setDiffListScrollRow, 3)).toBe(7);
    unmount();
  });

  it('anchors by item identity when items are inserted above', async () => {
    const setDiffListScrollRow = vi.fn();
    const before = [fileItem('a.ts'), commentItem('t1', 5)];
    const opts = baseOpts({
      layout: makeLayout(before, 4),
      selectedIndex: 1,
      setDiffListScrollRow,
    });
    const { rerender, unmount } = mountHook(opts);
    await flush();

    // A new file appears above; the selected comment is now index 2
    // and its top moved 1 → 2.
    const after = [fileItem('new.ts'), fileItem('a.ts'), commentItem('t1', 5)];
    rerender({ ...opts, layout: makeLayout(after, 4), selectedIndex: 2 });
    await flush();
    expect(foldOffset(setDiffListScrollRow, 1)).toBe(2);
    unmount();
  });

  it('falls back to scroll-into-view when the selected item is new', async () => {
    const setDiffListScrollRow = vi.fn();
    const before = [fileItem('a.ts')];
    const opts = baseOpts({
      layout: makeLayout(before, 4),
      selectedIndex: 0,
      setDiffListScrollRow,
    });
    const { rerender, unmount } = mountHook(opts);
    await flush();

    // A comment appears (bounds 1..6) and is selected — not present in
    // the previous layout, so anchor falls back to scrollIntoView.
    const after = [fileItem('a.ts'), commentItem('t1', 5)];
    rerender({ ...opts, layout: makeLayout(after, 4), selectedIndex: 1 });
    await flush();
    // scrollIntoView(0, {1,6}, 4) → min(top 1, bottom 6 − 4) = 1.
    expect(foldOffset(setDiffListScrollRow, 0)).toBe(1);
    unmount();
  });

  it('stays quiet when geometry is unchanged (plain navigation)', async () => {
    const setDiffListScrollRow = vi.fn();
    const items = [fileItem('a.ts'), fileItem('b.ts'), commentItem('t1', 5)];
    const opts = baseOpts({
      layout: makeLayout(items, 4),
      selectedIndex: 0,
      setDiffListScrollRow,
    });
    const { rerender, unmount } = mountHook(opts);
    await flush();
    rerender({ ...opts, layout: makeLayout(items, 4), selectedIndex: 1 });
    await flush();
    expect(setDiffListScrollRow).not.toHaveBeenCalled();
    unmount();
  });
});

describe('useDiffListScrollSync — post-reply reveal', () => {
  it('reveals the pending thread bottom and clears the pending id', async () => {
    const setDiffListScrollRow = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    // 6 file rows, then t1 (bounds 6..14); viewport 8, total 14.
    const items = [
      ...Array.from({ length: 6 }, (_, i) => fileItem(`f${i}.ts`)),
      commentItem('t1', 8),
    ];
    const { unmount } = mountHook(
      baseOpts({
        layout: makeLayout(items, 8),
        selectedIndex: 6,
        pendingScrollThreadId: 't1',
        setDiffListScrollRow,
        setPendingScrollThreadId,
      })
    );
    await flush();
    // bottom 14 − viewport 8 = 6.
    expect(foldOffset(setDiffListScrollRow, 0)).toBe(6);
    expect(setPendingScrollThreadId).toHaveBeenCalledWith(null);
    unmount();
  });

  it('waits (no clear) while the thread is not in the layout yet', async () => {
    const setDiffListScrollRow = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    const { unmount } = mountHook(
      baseOpts({
        layout: makeLayout([fileItem('a.ts')], 8),
        pendingScrollThreadId: 'missing',
        setDiffListScrollRow,
        setPendingScrollThreadId,
      })
    );
    await flush();
    expect(setDiffListScrollRow).not.toHaveBeenCalled();
    expect(setPendingScrollThreadId).not.toHaveBeenCalled();
    unmount();
  });
});
