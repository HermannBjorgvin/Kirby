/**
 * Pure scroll geometry for the single-file diff viewer.
 *
 * The viewer's scroll offset is a physical row index into the row map
 * produced by `buildRowMap` — not a diff-line index. Three of the
 * pane's rows go to chrome rather than diff content, so every scroll
 * calculation in the viewer (keyboard paging, auto-select on file
 * open, post-reply reveal) works against `paneRows - 3`. Keeping that
 * constant in one place is what stops those three from disagreeing
 * about where the fold is.
 */

/** Rows of diff content visible in a pane `paneRows` tall. */
export function diffViewportHeight(paneRows: number): number {
  return Math.max(1, paneRows - 3);
}

/**
 * Largest scroll offset that still fills the viewport — 0 when the
 * content is shorter than the viewport.
 */
export function maxDiffScrollOffset(
  totalRows: number,
  paneRows: number
): number {
  return Math.max(0, totalRows - diffViewportHeight(paneRows));
}

export interface RevealThreadEndOptions {
  /** Current scroll offset (physical row). */
  current: number;
  /** First row of the thread, from `rowMap.positions[headerLine]`. */
  rowStart: number;
  /** Rows the thread occupies, from the same row-map entry. */
  rowSpan: number;
  /** Total scrollable rows (`rowMap.totalRows`). */
  totalRows: number;
  /** Pane height in rows. */
  paneRows: number;
}

/**
 * Scroll down just far enough that a thread's last row is on screen
 * with one blank row of breathing room beneath it, then clamp to the
 * end of the content.
 *
 * Never scrolls up: if the caller is already below the thread the
 * offset is left alone, so revealing a thread can't yank the viewport
 * backwards over content the user scrolled to deliberately.
 */
export function revealThreadEndOffset({
  current,
  rowStart,
  rowSpan,
  totalRows,
  paneRows,
}: RevealThreadEndOptions): number {
  const viewportHeight = diffViewportHeight(paneRows);
  const threadEndRow = rowStart + rowSpan - 1;
  // +2 rather than +1: one row to bring `threadEndRow` itself onto the
  // last visible line, one more for the blank row under it.
  const minOffset = Math.max(0, threadEndRow - viewportHeight + 2);
  return Math.min(
    Math.max(current, minOffset),
    maxDiffScrollOffset(totalRows, paneRows)
  );
}
