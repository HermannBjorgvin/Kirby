import type { TerminalKind } from '../../../host/contract.js';
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

function terminalTab(entry: TerminalEntry): TerminalTab {
  return {
    id: terminalTabId(entry.name),
    kind: 'terminal',
    name: entry.name,
    terminalKind: entry.kind,
    cwd: entry.cwd,
    displayPath: entry.displayPath,
    repo: entry.repo,
    preview: false,
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
    tabs: [...state.tabs, terminalTab(entry)],
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
 * Focus never moves: a restored terminal from another repository would
 * otherwise switch the workspace at startup. A tab that is already
 * there has its stamp refreshed, and an unchanged listing returns the
 * same state object so a quiet poll does not re-render the strip.
 */
export function syncTerminals(
  state: TabsState,
  entries: TerminalEntry[]
): TabsState {
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
    tabs = [...tabs, terminalTab(entry)];
    changed = true;
  }
  if (!changed) return state;
  return { ...state, tabs, autoOpened: [...opened] };
}

/** The listing's view of a terminal, onto its tab — the same tab when
 *  nothing moved. The directory itself never changes; what can is its
 *  repository (a `.git` appearing) and how home is written. */
function restamp(tab: TerminalTab, entry: TerminalEntry): TerminalTab {
  if (
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
  };
}
