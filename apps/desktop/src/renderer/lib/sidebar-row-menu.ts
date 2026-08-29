import type { ContextMenuItem } from '../../host/contract.js';

/** What a sidebar row's native context menu can do. */
export type SidebarRowCommand =
  | 'open'
  | 'launch'
  | 'kill'
  | 'checkout'
  | 'open-pr'
  | 'open-editor'
  | 'copy'
  | 'remove';

export interface SidebarRowMenuState {
  /** The row has a checkout on disk. */
  hasWorktree: boolean;
  /** An agent is alive in it. */
  running: boolean;
  /** The row is backed by a pull request. */
  hasPr: boolean;
}

/**
 * The entries a sidebar row offers, given what that row currently is.
 *
 * A menu the OS renders cannot disable an entry the way a web menu can,
 * so an action that would fail is simply absent: launching and stopping
 * are mutually exclusive, checkout only shows for a row with no
 * worktree, and removal only for a row that has one. Keeping that as a
 * value rather than as JSX is what lets the rules be asserted without
 * driving Electron.
 */
export function sidebarRowMenuItems(
  state: SidebarRowMenuState
): ContextMenuItem[] {
  const { hasWorktree, running, hasPr } = state;
  const items: ContextMenuItem[] = [
    { id: 'open', label: 'Open' },
    { type: 'separator' },
  ];
  if (hasWorktree && !running)
    items.push({ id: 'launch', label: 'Launch agent' });
  if (hasWorktree && running) items.push({ id: 'kill', label: 'Stop agent' });
  if (!hasWorktree)
    items.push({ id: 'checkout', label: 'Check out as worktree' });
  if (hasPr)
    items.push({ id: 'open-pr', label: 'Open pull request in browser' });
  items.push({ id: 'open-editor', label: 'Open in editor' });
  items.push({ id: 'copy', label: 'Copy branch name' });
  if (hasWorktree) {
    items.push(
      { type: 'separator' },
      {
        id: 'remove',
        label: 'Remove worktree…',
        danger: true,
      }
    );
  }
  return items;
}
