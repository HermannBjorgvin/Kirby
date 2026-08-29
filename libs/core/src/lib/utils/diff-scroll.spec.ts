import { describe, it, expect } from 'vitest';
import {
  diffViewportHeight,
  maxDiffScrollOffset,
  revealThreadEndOffset,
} from './diff-scroll.js';

describe('diffViewportHeight', () => {
  it('spends three of the pane rows on chrome', () => {
    expect(diffViewportHeight(10)).toBe(7);
    expect(diffViewportHeight(40)).toBe(37);
  });

  it('never reports a viewport smaller than one row', () => {
    expect(diffViewportHeight(3)).toBe(1);
    expect(diffViewportHeight(1)).toBe(1);
    expect(diffViewportHeight(0)).toBe(1);
  });
});

describe('maxDiffScrollOffset', () => {
  it('leaves the last viewport of content on screen', () => {
    expect(maxDiffScrollOffset(100, 10)).toBe(93);
  });

  it('is zero when the content is shorter than the viewport', () => {
    expect(maxDiffScrollOffset(3, 10)).toBe(0);
    expect(maxDiffScrollOffset(0, 10)).toBe(0);
  });
});

describe('revealThreadEndOffset', () => {
  // A thread occupying rows 50..54 in a 100-row diff, in a 10-row pane
  // (7 rows of content).
  const thread = {
    rowStart: 50,
    rowSpan: 5,
    totalRows: 100,
    paneRows: 10,
  } as const;

  it('scrolls the thread end on screen with one row to spare', () => {
    const offset = revealThreadEndOffset({ current: 0, ...thread });
    expect(offset).toBe(49);

    // Restated as the property the number encodes: the thread's last
    // row (54) is visible, and it is not the last visible row — there
    // is one blank row beneath it.
    const lastVisibleRow = offset + diffViewportHeight(thread.paneRows) - 1;
    const threadEndRow = thread.rowStart + thread.rowSpan - 1;
    expect(lastVisibleRow).toBe(threadEndRow + 1);
  });

  it('leaves the offset alone when the thread end is already revealed', () => {
    expect(revealThreadEndOffset({ current: 49, ...thread })).toBe(49);
    expect(revealThreadEndOffset({ current: 55, ...thread })).toBe(55);
  });

  it('never scrolls backwards', () => {
    // The user has scrolled well past the thread; revealing it must
    // not yank the viewport back up to it.
    expect(revealThreadEndOffset({ current: 80, ...thread })).toBe(80);
  });

  it('clamps to the end of the content', () => {
    expect(revealThreadEndOffset({ current: 200, ...thread })).toBe(93);
  });

  it('clamps to zero when the whole diff fits in the viewport', () => {
    // Thread end (54) is past the viewport, but there are only 3 rows
    // of content — scrolling at all would show blank space.
    expect(revealThreadEndOffset({ current: 0, ...thread, totalRows: 3 })).toBe(
      0
    );
  });

  it('does not scroll a thread that is already fully on screen at the top', () => {
    expect(
      revealThreadEndOffset({
        current: 0,
        rowStart: 0,
        rowSpan: 3,
        totalRows: 100,
        paneRows: 10,
      })
    ).toBe(0);
  });

  it('uses the one-row viewport floor on a pane too short for chrome', () => {
    // paneRows 1 → viewport 1. Without the floor the viewport would be
    // -2 and the offset would overshoot the thread entirely.
    expect(revealThreadEndOffset({ current: 0, ...thread, paneRows: 1 })).toBe(
      55
    );
  });

  it('reveals a taller thread further down than a short one', () => {
    // rowSpan is what a posted reply grows — a taller thread must scroll
    // further, or the new reply lands below the fold.
    const short = revealThreadEndOffset({ current: 0, ...thread });
    const tall = revealThreadEndOffset({ current: 0, ...thread, rowSpan: 9 });
    expect(tall).toBe(short + 4);
  });
});
