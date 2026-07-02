/**
 * Pure geometry for a row-granular virtual viewport over variable-
 * height items — the scroll model the diff viewer pioneered, factored
 * out so other panes (diff-file-list footer, sidebar, …) can share it.
 *
 * Coordinates are physical terminal rows. Items are described only by
 * their estimated row heights (`spans`); the viewport is an `offset`
 * (top row) plus a height. Navigation is "web-like": selection moves
 * item-by-item with minimal scroll-into-view, and an item taller than
 * the viewport consumes scroll steps until its far edge is visible
 * before selection advances past it.
 */

export interface ItemBounds {
  /** First row of the item (inclusive). */
  top: number;
  /** Row after the item's last row (exclusive). */
  bottom: number;
}

/** Cumulative row bounds for each item. */
export function itemBounds(spans: number[]): ItemBounds[] {
  const bounds: ItemBounds[] = [];
  let row = 0;
  for (const span of spans) {
    bounds.push({ top: row, bottom: row + span });
    row += span;
  }
  return bounds;
}

export function totalRows(spans: number[]): number {
  return spans.reduce((sum, s) => sum + s, 0);
}

/**
 * Body rows for a given total budget: when content fits, no indicator
 * lines render and the whole budget is body; when clipped, the ↑/↓
 * indicator placeholders permanently occupy 2 of the budget rows.
 * Callers must use this same value for scroll math (clamping,
 * scroll-into-view, stepping) so input and render agree.
 */
export function viewportRowsForBudget(
  totalContentRows: number,
  budgetRows: number
): number {
  return totalContentRows <= budgetRows
    ? budgetRows
    : Math.max(1, budgetRows - 2);
}

/** Clamp an offset so the viewport never scrolls past the content. */
export function clampOffset(
  offset: number,
  total: number,
  viewportRows: number
): number {
  return Math.max(0, Math.min(offset, total - viewportRows));
}

/**
 * Minimal scroll that brings an item into view: no-op when already
 * fully visible, top-aligns when the item is above the viewport or
 * taller than it, bottom-aligns when below.
 */
export function scrollIntoView(
  offset: number,
  item: ItemBounds,
  viewportRows: number
): number {
  if (item.top < offset) return item.top;
  if (item.bottom > offset + viewportRows) {
    return Math.min(item.top, item.bottom - viewportRows);
  }
  return offset;
}

/**
 * Scroll down just enough that the item's BOTTOM row is visible —
 * never scrolls up. Used to keep an open compose input (which grows
 * an item downward) on screen while the user types.
 */
export function revealBottom(
  offset: number,
  item: ItemBounds,
  viewportRows: number
): number {
  return Math.max(offset, item.bottom - viewportRows);
}

/**
 * Scroll-anchoring: when item spans change upstream of the viewport,
 * shift the offset by the anchor item's top-row delta so the viewport
 * stays glued to the content the user was looking at instead of to an
 * absolute row number (the terminal equivalent of browser scroll
 * anchoring).
 */
export function anchorAdjust(opts: {
  offset: number;
  prevTop: number;
  nextTop: number;
  totalRows: number;
  viewportRows: number;
}): number {
  return clampOffset(
    opts.offset + (opts.nextTop - opts.prevTop),
    opts.totalRows,
    opts.viewportRows
  );
}

export interface StepResult {
  offset: number;
  index: number;
  /**
   * False when the step was a no-op (already on the boundary item with
   * its far edge in view) — callers use this to hand navigation off to
   * an adjacent region (e.g. leave the footer back into the file list).
   */
  moved: boolean;
}

/** Rows a within-item scroll advances per keypress: half the viewport. */
function scrollStep(viewportRows: number): number {
  return Math.max(1, Math.floor(viewportRows / 2));
}

/**
 * One "down" keypress. If the selected item's bottom is out of view,
 * scroll to reveal more of it (never past its bottom edge); otherwise
 * advance selection and scroll the next item into view.
 */
export function stepNext(opts: {
  spans: number[];
  index: number;
  offset: number;
  viewportRows: number;
}): StepResult {
  const { spans, index, offset, viewportRows } = opts;
  const bounds = itemBounds(spans);
  const cur = bounds[index];
  if (!cur) return { offset, index, moved: false };

  if (cur.bottom > offset + viewportRows) {
    const next = Math.min(
      offset + scrollStep(viewportRows),
      cur.bottom - viewportRows
    );
    return { offset: next, index, moved: next !== offset };
  }

  const nextItem = bounds[index + 1];
  if (!nextItem) return { offset, index, moved: false };
  return {
    offset: scrollIntoView(offset, nextItem, viewportRows),
    index: index + 1,
    moved: true,
  };
}

/**
 * One "up" keypress — mirror of `stepNext`: reveal more of the current
 * item above, else move selection up and scroll it into view.
 */
export function stepPrev(opts: {
  spans: number[];
  index: number;
  offset: number;
  viewportRows: number;
}): StepResult {
  const { spans, index, offset, viewportRows } = opts;
  const bounds = itemBounds(spans);
  const cur = bounds[index];
  if (!cur) return { offset, index, moved: false };

  if (cur.top < offset) {
    const next = Math.max(offset - scrollStep(viewportRows), cur.top);
    return { offset: next, index, moved: next !== offset };
  }

  const prevItem = bounds[index - 1];
  if (!prevItem) return { offset, index, moved: false };
  return {
    offset: scrollIntoView(offset, prevItem, viewportRows),
    index: index - 1,
    moved: true,
  };
}
