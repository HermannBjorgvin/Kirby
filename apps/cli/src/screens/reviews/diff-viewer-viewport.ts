import { diffViewportHeight } from '@kirby/core';
import type { RowMap } from '@kirby/review-comments';

export interface VisibleEntry {
  /** Index into the annotated-line stream this row map was built from. */
  sourceIndex: number;
  /** Rows of this entry that sit above the viewport's top edge. */
  topClip: number;
}

export interface DiffViewport {
  /** Rows the viewport occupies, chrome excluded. */
  viewportHeight: number;
  /** Rows left for entries once the scroll indicators have taken theirs. */
  bodyHeight: number;
  visible: VisibleEntry[];
  atTop: boolean;
  atBottom: boolean;
  rowsAbove: number;
  rowsBelow: number;
  totalRows: number;
}

/**
 * Which entries of a file diff are on screen, and by how much the top
 * one is clipped.
 *
 * The viewer scrolls by physical row rather than by entry, because a
 * comment card is many rows tall and stepping over one whole would jump
 * the view. So the top entry is usually partly above the edge: it is
 * rendered with a negative top margin of `topClip`, which is why the
 * clip has to be computed rather than rounded away.
 *
 * The scroll indicators ("↑ n rows above") are drawn inside the
 * viewport, so each one that is showing takes a row off the body —
 * without that the entries push past the bottom edge of the pane.
 */
export function diffViewerViewport(opts: {
  rowMap: RowMap;
  /** Length of the annotated-line stream the row map describes. */
  entryCount: number;
  scrollOffset: number;
  /** Rows the whole pane has, chrome included. */
  paneRows: number;
}): DiffViewport {
  const { rowMap, entryCount, scrollOffset, paneRows } = opts;

  // Chrome: header + divider + hints = 3 lines. Shared with the
  // keyboard scroll handlers via @kirby/core so the two cannot
  // disagree about where the fold is.
  const viewportHeight = diffViewportHeight(paneRows);

  // Row-based slice: pick every entry whose [rowStart, rowStart+rowSpan]
  // overlaps the viewport's [scrollOffset, scrollOffset+viewportHeight]
  // range. The first overlapping entry may have its top clipped — the
  // caller renders it inside a Box with marginTop={-topClip} so the
  // visible portion aligns with scrollOffset. The probe in commit
  // history (apps/cli/src/_probe/ink-clip.tsx) confirmed Ink/Yoga
  // handles this cleanly with `flexShrink={0}` on each child +
  // `overflow="hidden"` on the parent.
  const viewportTop = scrollOffset;
  const viewportBottom = scrollOffset + viewportHeight;
  const visible: VisibleEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const pos = rowMap.positions[i];
    if (!pos) continue;
    const top = pos.rowStart;
    const bottom = pos.rowStart + pos.rowSpan;
    if (bottom <= viewportTop) continue;
    if (top >= viewportBottom) break;
    visible.push({ sourceIndex: i, topClip: Math.max(0, viewportTop - top) });
  }

  const totalRows = rowMap.totalRows;
  const atTop = scrollOffset === 0;
  const atBottom = scrollOffset + viewportHeight >= totalRows;

  // Reserve one viewport row for each scroll indicator we'll render
  // (↑ / ↓), so the body region stays bounded by `viewportHeight` even
  // when the indicators occupy a row. Without this the indicators
  // would push entries past the bottom edge.
  const indicatorRows = (atTop ? 0 : 1) + (atBottom ? 0 : 1);

  return {
    viewportHeight,
    bodyHeight: Math.max(1, viewportHeight - indicatorRows),
    visible,
    atTop,
    atBottom,
    rowsAbove: scrollOffset,
    rowsBelow: Math.max(0, totalRows - (scrollOffset + viewportHeight)),
    totalRows,
  };
}
