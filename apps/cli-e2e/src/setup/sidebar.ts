import type { Page, Locator } from '@playwright/test';

// Sidebar icon scheme (apps/cli/src/components/Sidebar.tsx):
//   ◉  selected + running
//   ◎  selected + stopped
//   ●  not-selected + running
//   ○  not-selected + stopped

const SELECTED = '◉◎';
const RUNNING = '◉●';
const ANY = '◉◎●○';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The title follows its icon directly (only whitespace between them).
// Anything looser bridges into the main pane, which shares the terminal
// row: a PR detail pane repeats the PR title to the right of whichever
// sidebar entry sits on that row, and `[◎].*Add color support` would
// match that entry too.
export function selectedItem(title: string): RegExp {
  return new RegExp(`[${SELECTED}]\\s*${escapeRegExp(title)}`);
}

export function anyItem(title: string): RegExp {
  return new RegExp(`[${ANY}]\\s*${escapeRegExp(title)}`);
}

/** A row with a live agent behind it, selected or not. */
export function runningItem(title: string): RegExp {
  return new RegExp(`[${RUNNING}].*${escapeRegExp(title)}`);
}

// Scope the icon-then-title regex to a single .term-row. Without this,
// Playwright's getByText(/regex/) matches against any element's combined
// text, so the pattern bridges across rows — e.g. `/[◉◎]\s*Add color/`
// would spuriously match when `◉` sits next to a DIFFERENT session that
// happens to appear before "Add color" in the grid.
export function sidebarLocator(page: Page, title: string) {
  return {
    selected: (): Locator =>
      page.locator('.term-row', { hasText: selectedItem(title) }),
    any: (): Locator => page.locator('.term-row', { hasText: anyItem(title) }),
    running: (): Locator =>
      page.locator('.term-row', { hasText: runningItem(title) }),
  };
}
