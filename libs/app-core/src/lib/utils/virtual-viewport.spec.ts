import { describe, it, expect } from 'vitest';
import {
  itemBounds,
  totalRows,
  clampOffset,
  viewportRowsForBudget,
  scrollIntoView,
  revealBottom,
  anchorAdjust,
  stepNext,
  stepPrev,
} from './virtual-viewport.js';

describe('itemBounds', () => {
  it('accumulates spans into [top, bottom) ranges', () => {
    expect(itemBounds([3, 5, 2])).toEqual([
      { top: 0, bottom: 3 },
      { top: 3, bottom: 8 },
      { top: 8, bottom: 10 },
    ]);
  });

  it('handles an empty list', () => {
    expect(itemBounds([])).toEqual([]);
    expect(totalRows([])).toBe(0);
  });
});

describe('viewportRowsForBudget', () => {
  it('uses the whole budget when content fits', () => {
    expect(viewportRowsForBudget(8, 10)).toBe(10);
  });

  it('reserves 2 indicator rows when clipped', () => {
    expect(viewportRowsForBudget(30, 10)).toBe(8);
  });

  it('never returns less than one row', () => {
    expect(viewportRowsForBudget(30, 1)).toBe(1);
  });
});

describe('clampOffset', () => {
  it('clamps into [0, total - viewport]', () => {
    expect(clampOffset(-5, 30, 10)).toBe(0);
    expect(clampOffset(15, 30, 10)).toBe(15);
    expect(clampOffset(99, 30, 10)).toBe(20);
  });

  it('returns 0 when content fits', () => {
    expect(clampOffset(5, 8, 10)).toBe(0);
  });
});

describe('scrollIntoView', () => {
  const item = { top: 10, bottom: 16 };

  it('is a no-op when the item is fully visible', () => {
    expect(scrollIntoView(8, item, 10)).toBe(8);
  });

  it('top-aligns when the item is above the viewport', () => {
    expect(scrollIntoView(12, item, 10)).toBe(10);
  });

  it('bottom-aligns when the item is below the viewport', () => {
    expect(scrollIntoView(0, item, 10)).toBe(6);
  });

  it('top-aligns an item taller than the viewport', () => {
    expect(scrollIntoView(0, { top: 10, bottom: 40 }, 10)).toBe(10);
  });
});

describe('revealBottom', () => {
  const item = { top: 10, bottom: 16 };

  it('is a no-op when the bottom is already visible', () => {
    expect(revealBottom(8, item, 10)).toBe(8);
  });

  it('scrolls down exactly enough to show the bottom row', () => {
    expect(revealBottom(0, item, 10)).toBe(6);
  });

  it('never scrolls up, even when the item is above the viewport', () => {
    expect(revealBottom(30, item, 10)).toBe(30);
  });
});

describe('anchorAdjust', () => {
  it('shifts the offset by the anchor top delta (growth above)', () => {
    expect(
      anchorAdjust({
        offset: 5,
        prevTop: 8,
        nextTop: 12,
        totalRows: 40,
        viewportRows: 10,
      })
    ).toBe(9);
  });

  it('shifts back when content above shrinks', () => {
    expect(
      anchorAdjust({
        offset: 9,
        prevTop: 12,
        nextTop: 8,
        totalRows: 40,
        viewportRows: 10,
      })
    ).toBe(5);
  });

  it('clamps at both ends of the stream', () => {
    expect(
      anchorAdjust({
        offset: 2,
        prevTop: 10,
        nextTop: 2,
        totalRows: 40,
        viewportRows: 10,
      })
    ).toBe(0);
    expect(
      anchorAdjust({
        offset: 28,
        prevTop: 2,
        nextTop: 12,
        totalRows: 40,
        viewportRows: 10,
      })
    ).toBe(30);
  });
});

describe('stepNext / stepPrev — web-like j/k', () => {
  // Three cards: 4 rows, 20 rows (taller than viewport), 4 rows.
  const spans = [4, 20, 4];
  const viewportRows = 8;

  it('advances selection when the current item is fully visible', () => {
    const r = stepNext({ spans, index: 0, offset: 0, viewportRows });
    expect(r).toEqual({ offset: 4, index: 1, moved: true });
  });

  it('scrolls within a tall item before advancing selection', () => {
    // Card 1 spans rows 4..24; at offset 4 its bottom (24) is out of
    // view, so j scrolls by half the viewport and selection stays.
    const r = stepNext({ spans, index: 1, offset: 4, viewportRows });
    expect(r.index).toBe(1);
    expect(r.offset).toBe(8);
    expect(r.moved).toBe(true);
  });

  it('stops scrolling at the tall item bottom edge, then advances', () => {
    // Scroll until bottom (24) visible: offset 16 → bottom row 24 ✓.
    let offset = 4;
    let steps = 0;
    for (;;) {
      const r = stepNext({ spans, index: 1, offset, viewportRows });
      if (r.index !== 1) break;
      expect(r.moved).toBe(true);
      offset = r.offset;
      steps++;
      expect(steps).toBeLessThan(10);
    }
    expect(offset).toBe(16); // 24 - viewport
  });

  it('does not move past the last item', () => {
    const r = stepNext({ spans, index: 2, offset: 20, viewportRows });
    expect(r.moved).toBe(false);
    expect(r.index).toBe(2);
  });

  it('scrolls up within a tall item before moving selection up', () => {
    // Card 1 top (4) above offset 16 → k scrolls up, stays on card 1.
    const r = stepPrev({ spans, index: 1, offset: 16, viewportRows });
    expect(r.index).toBe(1);
    expect(r.offset).toBe(12);
  });

  it('moves selection up when the current item top is visible', () => {
    const r = stepPrev({ spans, index: 1, offset: 4, viewportRows });
    expect(r).toEqual({ offset: 0, index: 0, moved: true });
  });

  it('reports moved: false on the first item with top in view', () => {
    const r = stepPrev({ spans, index: 0, offset: 0, viewportRows });
    expect(r.moved).toBe(false);
  });
});
