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

export function sidebarLocator(page: Page, title: string) {
  return {
    selected: (): Locator => page.getByText(selectedItem(title)),
    any: (): Locator => page.getByText(anyItem(title)),
  };
}
