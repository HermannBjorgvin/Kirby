import type { Page, Locator } from '@playwright/test';

// Sidebar icon scheme (apps/cli/src/components/Sidebar.tsx):
//   ◉  selected + running
//   ◎  selected + stopped
//   ●  not-selected + running
//   ○  not-selected + stopped

const SELECTED = '◉◎';
const ANY = '◉◎●○';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function selectedItem(title: string): RegExp {
  return new RegExp(`[${SELECTED}].*${escapeRegExp(title)}`);
}

export function anyItem(title: string): RegExp {
  return new RegExp(`[${ANY}].*${escapeRegExp(title)}`);
}

// Scope the icon-then-title regex to a single .term-row. Without this,
// Playwright's getByText(/regex/) matches against any element's combined
// text, so `.*` bridges across rows — e.g. `/[◉◎].*Add color support/`
// would spuriously match when `◉` sits next to a DIFFERENT session that
// happens to appear before "Add color support" in the grid.
export function sidebarLocator(page: Page, title: string) {
  return {
    selected: (): Locator =>
      page.locator('.term-row', { hasText: selectedItem(title) }),
    any: (): Locator => page.locator('.term-row', { hasText: anyItem(title) }),
  };
}
