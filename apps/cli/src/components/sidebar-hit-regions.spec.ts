import { describe, it, expect } from 'vitest';
import { buildSidebarHitTest } from './sidebar-hit-regions.js';

// Mirror of the sidebar's visible-row model: the hit test maps a
// terminal row (1-based, as reported by SGR mouse events) back to the
// item under the pointer, and whether the pointer is on the item's
// PR-badge line.

describe('buildSidebarHitTest', () => {
  it('maps rows to items below the top border', () => {
    // Screen: row 1 = border/title, row 2 = header, rows 3/4 = items
    const hit = buildSidebarHitTest({
      visibleRows: [
        { type: 'header', height: 1 },
        { type: 'item', itemIndex: 0, height: 1, badgeLineOffset: null },
        { type: 'item', itemIndex: 1, height: 1, badgeLineOffset: null },
      ],
      hasAboveIndicator: false,
    });
    expect(hit(1)).toBeNull(); // border
    expect(hit(2)).toBeNull(); // section header
    expect(hit(3)).toEqual({ itemIndex: 0, badgeLine: false });
    expect(hit(4)).toEqual({ itemIndex: 1, badgeLine: false });
    expect(hit(5)).toBeNull(); // past the list
  });

  it('identifies the badge line inside a multi-row item', () => {
    // Session item: title row + badge row (vcsConfigured)
    const hit = buildSidebarHitTest({
      visibleRows: [
        { type: 'header', height: 1 },
        { type: 'item', itemIndex: 0, height: 2, badgeLineOffset: 1 },
        { type: 'item', itemIndex: 1, height: 3, badgeLineOffset: 1 },
      ],
      hasAboveIndicator: false,
    });
    expect(hit(3)).toEqual({ itemIndex: 0, badgeLine: false }); // title
    expect(hit(4)).toEqual({ itemIndex: 0, badgeLine: true }); // badge
    expect(hit(5)).toEqual({ itemIndex: 1, badgeLine: false }); // title
    expect(hit(6)).toEqual({ itemIndex: 1, badgeLine: true }); // badge
    expect(hit(7)).toEqual({ itemIndex: 1, badgeLine: false }); // author
  });

  it('accounts for the "more above" indicator line', () => {
    const hit = buildSidebarHitTest({
      visibleRows: [
        { type: 'item', itemIndex: 5, height: 1, badgeLineOffset: null },
      ],
      hasAboveIndicator: true,
    });
    expect(hit(2)).toBeNull(); // ↑ N more
    expect(hit(3)).toEqual({ itemIndex: 5, badgeLine: false });
  });

  it('respects double-height section headers', () => {
    // Non-first headers render a marginTop + divider = 2 rows
    const hit = buildSidebarHitTest({
      visibleRows: [
        { type: 'header', height: 1 },
        { type: 'item', itemIndex: 0, height: 1, badgeLineOffset: null },
        { type: 'header', height: 2 },
        { type: 'item', itemIndex: 1, height: 1, badgeLineOffset: null },
      ],
      hasAboveIndicator: false,
    });
    expect(hit(3)).toEqual({ itemIndex: 0, badgeLine: false });
    expect(hit(4)).toBeNull();
    expect(hit(5)).toBeNull();
    expect(hit(6)).toEqual({ itemIndex: 1, badgeLine: false });
  });
});
