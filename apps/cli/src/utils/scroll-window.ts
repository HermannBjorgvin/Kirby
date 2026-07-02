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
