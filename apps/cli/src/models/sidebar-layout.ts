/**
 * The sidebar's layout decisions, with no Ink in them: which section a
 * row belongs to, how the flat item list becomes a list of rows with
 * section headers, how tall each row is, and which slice of it fits on
 * screen.
 *
 * Rows are not uniform height — a session row grows a line for a
 * conflict count and another for its PR badge — so the visible window
 * cannot be computed from an index alone, and getting it wrong hides
 * the row the user is on. Keeping it here makes those rules assertable
 * without rendering a terminal.
 */
import { LAYOUT } from '@kirby/app-core';
import { computeScrollWindow, type SidebarItem } from '@kirby/core';

// Rows the sidebar does NOT get for scrollable items:
//   - Pane border (top + bottom)       → LAYOUT.PANE_BORDER_ROWS
//   - Pane title row ("Kirby")         → LAYOUT.PANE_TITLE_ROWS
// This compensates for the fact that Sidebar gets `termRows` (the full
// terminal height) but actually renders inside a smaller flex slot.
const SIDEBAR_CHROME_ROWS = LAYOUT.PANE_BORDER_ROWS + LAYOUT.PANE_TITLE_ROWS;
const LEGEND_LINES = 2; // "passed/failed/pending" + "needs attention/approved"

export type SectionKey =
  | 'worktrees'
  | 'pull-requests'
  | 'draft-pull-requests'
  | 'needs-review'
  | 'waiting'
  | 'approved';

export function getSectionKey(item: SidebarItem): SectionKey {
  if (item.kind === 'session') {
    if (!item.pr) return 'worktrees';
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  }
  if (item.kind === 'orphan-pr')
    return item.pr.isDraft ? 'draft-pull-requests' : 'pull-requests';
  return item.category;
}

export const SECTION_LABELS: Record<
  SectionKey,
  { title: string; color: string }
> = {
  worktrees: { title: 'Worktrees', color: 'cyan' },
  'pull-requests': { title: 'Pull Requests', color: 'blue' },
  'draft-pull-requests': { title: 'Draft Pull Requests', color: 'gray' },
  'needs-review': { title: 'Needs Your Review', color: 'red' },
  waiting: { title: 'Waiting for Author', color: 'yellow' },
  approved: { title: 'Approved by You', color: 'green' },
};

export type RenderRow =
  | { type: 'header'; key: SectionKey; count: number; first: boolean }
  | { type: 'item'; item: SidebarItem; itemIndex: number };

/** Interleave section headers into the item list. Each header carries
 *  the size of the whole section, not of the run it opens — the items
 *  arrive already grouped, so the two agree. */
export function buildSidebarRows(items: SidebarItem[]): RenderRow[] {
  const result: RenderRow[] = [];
  let lastSection: SectionKey | null = null;
  let isFirst = true;

  // Count items per section for the header
  const sectionCounts = new Map<SectionKey, number>();
  for (const item of items) {
    const key = getSectionKey(item);
    sectionCounts.set(key, (sectionCounts.get(key) ?? 0) + 1);
  }

  items.forEach((item, idx) => {
    const section = getSectionKey(item);
    // Insert section header at every section transition
    if (section !== lastSection) {
      result.push({
        type: 'header',
        key: section,
        count: sectionCounts.get(section) ?? 0,
        first: isFirst,
      });
      isFirst = false;
      lastSection = section;
    }
    result.push({ type: 'item', item, itemIndex: idx });
  });
  return result;
}

/** Terminal lines each row occupies, in the same order as `rows`. */
export function sidebarRowHeights(
  rows: RenderRow[],
  vcsConfigured: boolean
): number[] {
  return rows.map((row): number => {
    if (row.type === 'header') return row.first ? 1 : 2; // divider (+ marginTop if not first)
    const { item } = row;
    if (item.kind === 'session') {
      let h = 1; // title line
      if (item.conflictCount != null && item.conflictCount > 0) h++;
      if (vcsConfigured) h++; // PrBadge (badge or "(no PR)")
      return h;
    }
    if (item.kind === 'orphan-pr') return 2; // title + badge
    return 3; // review: title + badge + "by author"
  });
}

/** Lines left for scrollable rows once the pane's own chrome, the
 *  keybind hints and the optional badge legend have taken theirs. */
export function sidebarAvailableLines(opts: {
  termRows: number;
  keybindLineCount: number;
  vcsConfigured: boolean;
  hintsHidden: boolean;
}): number {
  // Total non-item lines: sidebar chrome + keybinds margin + keybind lines + optional legend
  const chromeLines =
    SIDEBAR_CHROME_ROWS +
    1 +
    opts.keybindLineCount +
    (opts.vcsConfigured && !opts.hintsHidden ? 1 + LEGEND_LINES : 0);
  return opts.termRows - chromeLines;
}

export interface SidebarWindow {
  fullyVisibleRows: RenderRow[];
  /** Blank lines to push the "↓ n more" marker to the bottom. */
  gap: number;
  aboveCount: number;
  belowCount: number;
}

/**
 * The slice of rows that fits, centred on the selection.
 *
 * `computeScrollWindow` centres by index, which assumes uniform rows;
 * the greedy pass afterwards re-fits that start against the real
 * heights and slides forward until the selected row is inside the
 * window. Without that second pass a tall row above the selection
 * pushes it off the bottom and the user loses their cursor.
 */
export function sidebarScrollWindow(opts: {
  rows: RenderRow[];
  rowHeights: number[];
  selectedIndex: number;
  availableLines: number;
}): SidebarWindow {
  const { rows, rowHeights, selectedIndex, availableLines } = opts;
  const totalHeight = rowHeights.reduce((a, b) => a + b, 0);

  if (totalHeight <= availableLines) {
    return { fullyVisibleRows: rows, gap: 0, aboveCount: 0, belowCount: 0 };
  }

  // Reserve space for scroll indicators (↑/↓ more)
  const budget = availableLines - 2;

  // Estimate how many rows fit (from top) to get a maxVisible for centering
  let fitCount = 0;
  let fitHeight = 0;
  for (const height of rowHeights) {
    if (fitHeight + height > budget) break;
    fitHeight += height;
    fitCount++;
  }

  const selectedRowIdx = Math.max(
    0,
    rows.findIndex((r) => r.type === 'item' && r.itemIndex === selectedIndex)
  );

  // Use computeScrollWindow for centering, then verify with actual heights
  let start = computeScrollWindow({
    totalItems: rows.length,
    selectedIndex: selectedRowIdx,
    maxVisible: Math.max(1, fitCount),
  }).windowStart;

  // From start, greedily add rows that fully fit within budget
  const greedySlice = (from: number) => {
    let count = 0;
    let height = 0;
    for (let i = from; i < rows.length; i++) {
      if (height + rowHeights[i]! > budget) break;
      height += rowHeights[i]!;
      count++;
    }
    return { count, height };
  };

  let { count: fullCount, height: usedHeight } = greedySlice(start);

  // If selected row fell outside the visible window (row heights vary),
  // slide the window forward until the selected row is included.
  while (selectedRowIdx >= start + fullCount && start < rows.length - 1) {
    start++;
    ({ count: fullCount, height: usedHeight } = greedySlice(start));
  }

  const gap = budget - usedHeight;
  const nextIdx = start + fullCount;

  return {
    fullyVisibleRows: rows.slice(start, start + fullCount),
    gap,
    aboveCount: start,
    belowCount: Math.max(0, rows.length - nextIdx),
  };
}

/**
 * The single icon column: selection wins over running state (◉ / ◎ in
 * cyan), otherwise the row shows whether an agent is alive in it
 * (● green / ○ gray). Saves 2 chars vs. the old "› " + "● " two-column
 * layout, which is why the caret column is gone and should stay gone.
 * A row that cannot have an agent — a pull request with no worktree —
 * reads as not running, which is what it is.
 */
export function rowIcon(
  selected: boolean,
  running: boolean | undefined
): { icon: string; color: string } {
  if (selected) return { icon: running ? '◉' : '◎', color: 'cyan' };
  return running ? { icon: '●', color: 'green' } : { icon: '○', color: 'gray' };
}
