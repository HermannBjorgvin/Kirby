// Pure hit-testing for sidebar mouse clicks. The Sidebar component
// publishes a hit test built from the exact row model it just
// rendered (see sidebar-hit-test.ts), so click mapping can never
// drift from the painted layout.

export interface SidebarHit {
  itemIndex: number;
  /** True when the clicked line is the item's PR-badge line. */
  badgeLine: boolean;
}

export type SidebarHitRow =
  | { type: 'header'; height: number }
  | {
      type: 'item';
      itemIndex: number;
      height: number;
      /** Line offset (0-based within the item) of the PR badge, if any. */
      badgeLineOffset: number | null;
    };

// The sidebar's content starts on screen row 2 — row 1 is the pane's
// top border (with the title composed into it, no extra row).
const CONTENT_TOP_ROW = 2;

/**
 * Build a hit test mapping a 1-based terminal row (as reported by SGR
 * mouse events) to the sidebar item under the pointer.
 */
export function buildSidebarHitTest(opts: {
  visibleRows: SidebarHitRow[];
  /** Whether the "↑ N more" indicator occupies the first content line. */
  hasAboveIndicator: boolean;
}): (y: number) => SidebarHit | null {
  const { visibleRows, hasAboveIndicator } = opts;
  return (y: number) => {
    let cursor = CONTENT_TOP_ROW + (hasAboveIndicator ? 1 : 0);
    if (y < cursor) return null;
    for (const row of visibleRows) {
      if (y < cursor + row.height) {
        if (row.type !== 'item') return null;
        return {
          itemIndex: row.itemIndex,
          badgeLine: y - cursor === row.badgeLineOffset,
        };
      }
      cursor += row.height;
    }
    return null;
  };
}
