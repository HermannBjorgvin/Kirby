/** What a sidebar row's native context menu can do. */
const SIDEBAR_ROW_COMMANDS = [
  'open',
  'launch',
  'kill',
  'checkout',
  'open-pr',
  'babysit',
  'stop-babysit',
  'open-editor',
  'copy',
  'remove',
] as const;

export type SidebarRowCommand = (typeof SIDEBAR_ROW_COMMANDS)[number];

/** The commands that address the row's pull request rather than its
 *  worktree; the row hands these to its pull request hook. */
const PR_ROW_COMMANDS = ['open-pr', 'babysit', 'stop-babysit'] as const;

export type PrRowCommand = (typeof PR_ROW_COMMANDS)[number];

export function isPrRowCommand(
  command: SidebarRowCommand
): command is PrRowCommand {
  return (PR_ROW_COMMANDS as readonly string[]).includes(command);
}

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
  /** The pull request is being babysat. */
  babysitting?: boolean;
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
/**
 * The entries that address the pull request. Babysitting is a pull
 * request's, not a worktree's: it watches CI, review threads and
 * conflicts, and starts an agent in the worktree if none is running
 * when there is something to say.
 */
function pullRequestEntries(babysitting: boolean): SidebarRowMenuEntry[] {
  return [
    { id: 'open-pr', label: 'Open pull request in browser' },
    babysitting
      ? { id: 'stop-babysit', label: 'Stop babysitting' }
      : { id: 'babysit', label: 'Babysit pull request' },
  ];
}

export function sidebarRowMenuItems(
  state: SidebarRowMenuState
): SidebarRowMenuEntry[] {
  const { hasWorktree, running, hasPr, babysitting = false } = state;
  const items: SidebarRowMenuEntry[] = [
    { id: 'open', label: 'Open' },
    { type: 'separator' },
  ];
  if (hasWorktree && !running)
    items.push({ id: 'launch', label: 'Launch agent…' });
  if (hasWorktree && running) items.push({ id: 'kill', label: 'Stop agent' });
  if (!hasWorktree)
    items.push({ id: 'checkout', label: 'Check out as worktree' });
  if (hasPr) items.push(...pullRequestEntries(babysitting));
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
