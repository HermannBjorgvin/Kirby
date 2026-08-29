import { describe, expect, it } from 'vitest';
import type { RowMap } from '@kirby/review-comments';
import { diffViewerViewport } from './diff-viewer-viewport.js';

/** A row map for entries of the given heights, laid out end to end. */
function rowMapOf(spans: number[]): RowMap {
  let rowStart = 0;
  const positions = spans.map((rowSpan) => {
    const entry = { rowStart, rowSpan };
    rowStart += rowSpan;
    return entry;
  });
  return { positions, totalRows: rowStart, sectionAnchorRows: [] };
}

/** 20 single-row diff lines with a 6-row comment card in the middle. */
const SPANS = [...Array<number>(10).fill(1), 6, ...Array<number>(10).fill(1)];

function viewport(scrollOffset: number, paneRows = 13) {
  return diffViewerViewport({
    rowMap: rowMapOf(SPANS),
    entryCount: SPANS.length,
    scrollOffset,
    paneRows,
  });
}

describe('diffViewerViewport', () => {
  it('takes three rows of chrome off the pane', () => {
    expect(viewport(0, 13).viewportHeight).toBe(10);
    // Never less than one row, however cramped the pane.
    expect(viewport(0, 1).viewportHeight).toBe(1);
  });

  it('selects every entry that overlaps the viewport, and no others', () => {
    const win = viewport(0);
    // Ten rows of viewport, ten single-row entries: the card at index
    // 10 starts exactly at the bottom edge and so is not drawn.
    expect(win.visible.map((v) => v.sourceIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it('reports how far into the top entry the viewport starts', () => {
    // Row 12 is three rows into the six-row card at index 10.
    const win = viewport(13);
    expect(win.visible[0]).toEqual({ sourceIndex: 10, topClip: 3 });
    // Only the first entry is ever clipped; the rest start where they start.
    expect(win.visible.slice(1).every((v) => v.topClip === 0)).toBe(true);
  });

  it('keeps a tall entry visible until its last row scrolls past', () => {
    // The card spans rows 10..15. At offset 16 it is finally gone.
    expect(viewport(15).visible.map((v) => v.sourceIndex)).toContain(10);
    expect(viewport(16).visible.map((v) => v.sourceIndex)).not.toContain(10);
  });

  it('gives the body a row back for each scroll indicator it draws', () => {
    // At the top only the "↓ rows below" marker shows.
    const top = viewport(0);
    expect([top.atTop, top.atBottom]).toEqual([true, false]);
    expect(top.bodyHeight).toBe(9);

    // Mid-scroll both markers show.
    const middle = viewport(5);
    expect([middle.atTop, middle.atBottom]).toEqual([false, false]);
    expect(middle.bodyHeight).toBe(8);

    // Scrolled to the end, only "↑ rows above".
    const bottom = viewport(SPANS.length + 5);
    expect(bottom.atBottom).toBe(true);
    expect(bottom.bodyHeight).toBe(9);
  });

  it('counts the rows hidden on each side', () => {
    const win = viewport(4);
    expect(win.totalRows).toBe(26);
    expect(win.rowsAbove).toBe(4);
    expect(win.rowsBelow).toBe(26 - 14);
  });

  it('has nothing to show for an empty diff', () => {
    const win = diffViewerViewport({
      rowMap: rowMapOf([]),
      entryCount: 0,
      scrollOffset: 0,
      paneRows: 13,
    });
    expect(win.visible).toEqual([]);
    expect(win.totalRows).toBe(0);
    expect([win.atTop, win.atBottom]).toEqual([true, true]);
  });
});
