import type { Terminal } from '@microsoft/tui-test/lib/terminal/term.js';

// Sidebar icon scheme (Sidebar.tsx):
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
  return new RegExp(`[${SELECTED}].*${escapeRegExp(title)}`, 'g');
}

export function anyItem(title: string): RegExp {
  return new RegExp(`[${ANY}].*${escapeRegExp(title)}`, 'g');
}

export function sidebarLocator(terminal: Terminal, title: string) {
  return {
    selected: () => terminal.getByText(selectedItem(title), { strict: false }),
    any: () => terminal.getByText(anyItem(title), { strict: false }),
  };
}
