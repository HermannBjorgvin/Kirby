/**
 * Computes a scroll window over items of *variable* row height (spans),
 * keeping the selected item visible within a row budget.
 *
 * Used by the DiffFileList PR-comments footer, where each comment card
 * occupies several rows. When every item fits the budget the whole
 * range is returned; otherwise 2 rows are reserved for the ↑/↓ "more"
 * indicators and the window grows outward from the selected item
 * (downward first) until the budget is exhausted. A single item taller
 * than the budget is still included — callers clip it with a
 * fixed-height overflow="hidden" container.
 */
export function computeSpanScrollWindow(opts: {
  spans: number[];
  selectedIndex: number;
  budgetRows: number;
}): {
  start: number;
  end: number;
  aboveCount: number;
  belowCount: number;
} {
  const { spans, budgetRows } = opts;
  const n = spans.length;
  if (n === 0) return { start: 0, end: 0, aboveCount: 0, belowCount: 0 };

  const total = spans.reduce((sum, s) => sum + s, 0);
  if (total <= budgetRows) {
    return { start: 0, end: n, aboveCount: 0, belowCount: 0 };
  }

  const selected = Math.min(Math.max(0, opts.selectedIndex), n - 1);
  const cardBudget = Math.max(1, budgetRows - 2);

  let start = selected;
  let end = selected + 1;
  let used = spans[selected]!;
  let extended = true;
  while (extended) {
    extended = false;
    if (end < n && used + spans[end]! <= cardBudget) {
      used += spans[end]!;
      end++;
      extended = true;
    }
    if (start > 0 && used + spans[start - 1]! <= cardBudget) {
      used += spans[start - 1]!;
      start--;
      extended = true;
    }
  }

  return { start, end, aboveCount: start, belowCount: n - end };
}

/**
 * Computes a centered scroll window around the selected item.
 *
 * Used by BranchPicker, DiffFileList, and ReviewsSidebar to avoid
 * duplicating the same centering + clamping math.
 */
export function computeScrollWindow(opts: {
  totalItems: number;
  selectedIndex: number;
  maxVisible: number;
}): {
  windowStart: number;
  windowEnd: number;
  aboveCount: number;
  belowCount: number;
} {
  const { totalItems, selectedIndex, maxVisible } = opts;
  const listRows = Math.max(1, maxVisible);

  const halfWindow = Math.floor(listRows / 2);
  const maxStart = Math.max(0, totalItems - listRows);
  const windowStart = Math.min(
    Math.max(selectedIndex - halfWindow, 0),
    maxStart
  );
  const windowEnd = windowStart + listRows;

  const aboveCount = windowStart;
  const belowCount = Math.max(0, totalItems - windowEnd);

  return { windowStart, windowEnd, aboveCount, belowCount };
}
