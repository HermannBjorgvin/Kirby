import type { TerminalKind } from '../../../host/contract.js';
import { closeTab } from './tab-close.js';
import { terminalTabId, type Tab, type TerminalTab } from './tab-identity.js';
import type { TabsState } from './tabs-model.js';

/**
 * The terminal-tab passes of the reducer: opening one, and reconciling
 * the strip with the host's terminal listing.
 *
 * Kept beside `tab-sync.ts` rather than inside the reducer for the
 * same reason: these are the transitions specific to one tab kind, and
 * the reducer is the switch that dispatches to them.
 */

/** One terminal as the host lists it, as the tab model needs it. */
export interface TerminalEntry {
  name: string;
  kind: TerminalKind;
  cwd: string;
  displayPath: string;
  repo: string | null;
}

function terminalTab(entry: TerminalEntry, listed: boolean): TerminalTab {
  return {
    id: terminalTabId(entry.name),
    kind: 'terminal',
    name: entry.name,
    terminalKind: entry.kind,
    cwd: entry.cwd,
    displayPath: entry.displayPath,
    repo: entry.repo,
    preview: false,
    listed,
  };
}

/** Auto-open history key. Terminal names are globally unique, so no
 *  repository qualifier is needed. */
function seenKey(name: string): string {
  return terminalTabId(name);
}

/**
 * Activate the tab for a terminal, opening one if none is on it yet.
 *
 * Recorded as auto-opened as well, so a listing that follows the open
 * does not count it as new — and, if the user later closes it, does not
 * bring it back.
 */
export function openTerminal(
  state: TabsState,
  entry: TerminalEntry
): TabsState {
  const id = terminalTabId(entry.name);
  const existing = state.tabs.find((t) => t.id === id);
  if (existing) return { ...state, activeId: id };
  const seen = seenKey(entry.name);
  return {
    ...state,
    // Unlisted until a listing names it: the host answered the launch
    // before its listing caught up, and a sync landing in between
    // must not read the older listing as this terminal having ended.
    tabs: [...state.tabs, terminalTab(entry, false)],
    activeId: id,
    autoOpened: state.autoOpened.includes(seen)
      ? state.autoOpened
      : [...state.autoOpened, seen],
  };
}

/**
 * Reconcile the strip with the host's terminal listing.
 *
 * Every terminal gets a tab once — the restore path after a restart, and
 * one found by the running scan — recorded in `autoOpened` so a tab the
 * user closed stays closed while the host keeps listing the terminal.
 * Opening never moves focus: a restored terminal from another
 * repository would otherwise switch the workspace at startup. A tab
 * that is already there has its stamp refreshed, and an unchanged
 * listing returns the same state object so a quiet poll does not
 * re-render the strip.
 *
 * The listing is also the only word on which terminals still exist: a
 * tab whose terminal it no longer names has ended — the shell exited,
 * the agent quit, tmux killed the session from outside — and is closed
 * by {@link dropEnded}, with focus moving as a close in `repo` would.
 */
export function syncTerminals(
  state: TabsState,
  repo: string,
  entries: TerminalEntry[]
): TabsState {
  return dropEnded(openListed(state, entries), repo, entries);
}

/** The opening half: a tab per listed terminal that has not had one. */
function openListed(state: TabsState, entries: TerminalEntry[]): TabsState {
  const opened = new Set(state.autoOpened);
  const byId = new Map(
    state.tabs.flatMap((t): [string, TerminalTab][] =>
      t.kind === 'terminal' ? [[t.id, t]] : []
    )
  );
  let tabs: Tab[] = state.tabs;
  let changed = false;
  for (const entry of entries) {
    const id = terminalTabId(entry.name);
    const existing = byId.get(id);
    if (existing) {
      const stamped = restamp(existing, entry);
      if (stamped === existing) continue;
      tabs = tabs.map((t) => (t.id === id ? stamped : t));
      changed = true;
      continue;
    }
    const seen = seenKey(entry.name);
    if (opened.has(seen)) continue;
    opened.add(seen);
    tabs = [...tabs, terminalTab(entry, true)];
    changed = true;
  }
  if (!changed) return state;
  return { ...state, tabs, autoOpened: [...opened] };
}

/**
 * Close the tab of every terminal the listing no longer has.
 *
 * Through the same close as the user's, so the focus rules are the
 * user's too — the neighbour takes over, and never one from another
 * repository. The auto-open stamp goes with the tab: the host only
 * lists a name again when it re-adopted a live session under it (the
 * user detached from inside tmux and discovery found it still
 * running), and that terminal deserves its tab back rather than
 * running invisibly behind a stamp for a tab that ended. A tab still
 * open keeps its stamp whether or not the listing names it — closing
 * it later relies on that, or the listing that still names the
 * terminal until its kill lands would reopen it.
 */
function dropEnded(
  state: TabsState,
  repo: string,
  entries: TerminalEntry[]
): TabsState {
  const listed = new Set(entries.map((e) => terminalTabId(e.name)));
  let next = state;
  for (const tab of state.tabs) {
    if (tab.kind !== 'terminal' || !tab.listed || listed.has(tab.id)) continue;
    next = closeTab(next, tab.id, repo);
  }
  const open = new Set(next.tabs.map((t) => t.id));
  const autoOpened = next.autoOpened.filter(
    (key) => !key.startsWith('terminal:') || listed.has(key) || open.has(key)
  );
  if (autoOpened.length === next.autoOpened.length) return next;
  return { ...next, autoOpened };
}

/** The listing's view of a terminal, onto its tab — the same tab when
 *  nothing moved. The directory itself never changes; what can is its
 *  repository (a `.git` appearing) and how home is written. Being
 *  named by a listing at all is the other thing a tab learns here. */
function restamp(tab: TerminalTab, entry: TerminalEntry): TerminalTab {
  if (
    tab.listed &&
    tab.repo === entry.repo &&
    tab.displayPath === entry.displayPath &&
    tab.cwd === entry.cwd
  ) {
    return tab;
  }
  return {
    ...tab,
    cwd: entry.cwd,
    displayPath: entry.displayPath,
    repo: entry.repo,
    listed: true,
  };
}
