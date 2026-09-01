/** What a sidebar row's native context menu can do. */
const SIDEBAR_ROW_COMMANDS = [
  'open',
  'launch',
  'kill',
  'checkout',
  'open-pr',
  'open-editor',
  'copy',
  'remove',
] as const;

export type SidebarRowCommand = (typeof SIDEBAR_ROW_COMMANDS)[number];

/**
 * Narrow what the native menu resolves to.
 *
 * `showContextMenu` is one IPC call shared by every context menu in the
 * app, so it can only promise `string | null`. Checking the id against
 * the list here is what turns that back into a union — which is what
 * makes the caller's `switch` exhaustive, so adding a command without
 * handling it fails the build instead of rendering an entry that does
 * nothing when clicked.
 */
export function isSidebarRowCommand(
  chosen: string | null
): chosen is SidebarRowCommand {
  return (
    chosen !== null &&
    (SIDEBAR_ROW_COMMANDS as readonly string[]).includes(chosen)
  );
}

/** A menu entry whose id the compiler checks against the command list. */
type SidebarRowMenuEntry =
  | { type: 'separator' }
  | {
      id: SidebarRowCommand;
      label: string;
      enabled?: boolean;
      danger?: boolean;
    };

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
): SidebarRowMenuEntry[] {
  const { hasWorktree, running, hasPr } = state;
  const items: SidebarRowMenuEntry[] = [
    { id: 'open', label: 'Open' },
    { type: 'separator' },
  ];
  if (hasWorktree && !running)
    items.push({ id: 'launch', label: 'Launch agent…' });
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
