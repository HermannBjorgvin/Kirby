import { describe, it, expect, vi } from 'vitest';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type { CommentPositionInfo, RowMap } from '@kirby/review-comments';
import {
  usePendingThreadScrollIntoView,
  type UsePendingThreadScrollIntoViewOptions,
} from './usePendingThreadScrollIntoView.js';

function makeRowMap(
  positions: { rowStart: number; rowSpan: number }[]
): RowMap {
  return {
    totalRows: positions.reduce(
      (acc, p) => Math.max(acc, p.rowStart + p.rowSpan),
      0
    ),
    sectionAnchorRows: [0],
    positions,
  };
}

function Probe(props: { opts: UsePendingThreadScrollIntoViewOptions }) {
  usePendingThreadScrollIntoView(props.opts);
  return <Box />;
}

function mountHook(initial: UsePendingThreadScrollIntoViewOptions): {
  rerender: (next: UsePendingThreadScrollIntoViewOptions) => void;
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

describe('usePendingThreadScrollIntoView', () => {
  it('does nothing when pendingThreadId is null', async () => {
    const setDiffScrollOffset = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    const { unmount } = mountHook({
      pendingThreadId: null,
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 100,
      paneRows: 10,
      setDiffScrollOffset,
      setPendingScrollThreadId,
    });
    await flush();
    expect(setDiffScrollOffset).not.toHaveBeenCalled();
    expect(setPendingScrollThreadId).not.toHaveBeenCalled();
    unmount();
  });

  it('bails when the threadId is not in commentPositions', async () => {
    const setDiffScrollOffset = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    const { unmount } = mountHook({
      pendingThreadId: 'missing',
      commentPositions: new Map<string, CommentPositionInfo>(),
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 100,
      paneRows: 10,
      setDiffScrollOffset,
      setPendingScrollThreadId,
    });
    await flush();
    expect(setDiffScrollOffset).not.toHaveBeenCalled();
    expect(setPendingScrollThreadId).not.toHaveBeenCalled();
    unmount();
  });

  it('bails when rowMap has no entry for headerLine yet', async () => {
    const setDiffScrollOffset = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    const { unmount } = mountHook({
      pendingThreadId: 't1',
      commentPositions: new Map([['t1', { headerLine: 5, refStartLine: 5 }]]),
      // positions array shorter than headerLine — undefined entry
      rowMap: makeRowMap([{ rowStart: 0, rowSpan: 1 }]),
      diffTotalRows: 100,
      paneRows: 10,
      setDiffScrollOffset,
      setPendingScrollThreadId,
    });
    await flush();
    expect(setDiffScrollOffset).not.toHaveBeenCalled();
    expect(setPendingScrollThreadId).not.toHaveBeenCalled();
    unmount();
  });

  it('scrolls thread end into view + 1 row breathing room and clears pending id', async () => {
    const setDiffScrollOffset = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    const { unmount } = mountHook({
      pendingThreadId: 't1',
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      // thread sits at rows 50..54 (rowStart=50, rowSpan=5 → end=54)
      // viewportHeight = paneRows-3 = 7
      // minScrollOffset = max(0, 54 - 7 + 2) = 49
      // maxScroll = max(0, 100 - 7) = 93
      // updater(0) = clamp(0, 49, 93) = 49
      rowMap: makeRowMap([{ rowStart: 50, rowSpan: 5 }]),
      diffTotalRows: 100,
      paneRows: 10,
      setDiffScrollOffset,
      setPendingScrollThreadId,
    });
    await flush();
    expect(setDiffScrollOffset).toHaveBeenCalledTimes(1);
    const updater = setDiffScrollOffset.mock.calls[0]![0] as (
      n: number
    ) => number;
    expect(updater(0)).toBe(49);
    // honors a higher current scroll offset (don't scroll backwards)
    expect(updater(80)).toBe(80);
    // clamps to maxScroll
    expect(updater(200)).toBe(93);
    expect(setPendingScrollThreadId).toHaveBeenCalledWith(null);
    unmount();
  });

  it('does not re-fire after the pending id is cleared', async () => {
    const setDiffScrollOffset = vi.fn();
    const setPendingScrollThreadId = vi.fn();
    const baseOpts: UsePendingThreadScrollIntoViewOptions = {
      pendingThreadId: 't1',
      commentPositions: new Map([['t1', { headerLine: 0, refStartLine: 0 }]]),
      rowMap: makeRowMap([{ rowStart: 50, rowSpan: 5 }]),
      diffTotalRows: 100,
      paneRows: 10,
      setDiffScrollOffset,
      setPendingScrollThreadId,
    };
    const { rerender, unmount } = mountHook(baseOpts);
    await flush();
    expect(setDiffScrollOffset).toHaveBeenCalledTimes(1);

    // Simulate the parent clearing the pending id (which we just requested)
    rerender({ ...baseOpts, pendingThreadId: null });
    await flush();
    expect(setDiffScrollOffset).toHaveBeenCalledTimes(1);
    unmount();
  });
});
