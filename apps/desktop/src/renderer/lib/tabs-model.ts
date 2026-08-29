/**
 * Editor-area tab model (VS Code semantics, simplified):
 *   • `item` tabs are keyed by sidebar item key; one tab per item.
 *   • A single-click opens a *preview* tab (italic title) that gets
 *     replaced by the next preview; double-click or any interaction
 *     pins it.
 *   • `settings` is a singleton tab.
 */
export type Tab =
  | {
      id: string;
      kind: 'item';
      itemKey: string;
      preview: boolean;
      /** Last-known git branch, stamped by `sync-items`. The stable
       *  identity a tab falls back on when its itemKey goes stale —
       *  a worktree's key changes from `branch:x` to `pr:n` the moment
       *  a PR appears (and back when it closes). */
      branch?: string;
    }
  | { id: 'settings'; kind: 'settings'; preview: false };

/** One sidebar item as the tab model needs it. */
export interface ItemEntry {
  itemKey: string;
  branch: string;
  /** Whether an agent is live on this item right now. */
  running?: boolean;
  /** PTY session name, when the item has one. Present on every
   *  worktree row whether or not an agent was ever started, so it says
   *  nothing about liveness on its own — `running` does. */
  sessionName?: string;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string | null;
  /** Session names already auto-opened once by `sync-items`. History,
   *  not derivable from `tabs`: a tab the user closed and one that was
   *  never opened look identical, and only this tells them apart. */
  autoOpened: readonly string[];
}

export const EMPTY_TABS: TabsState = {
  tabs: [],
  activeId: null,
  autoOpened: [],
};

export type TabsAction =
  | { type: 'open-item'; itemKey: string; preview: boolean }
  | { type: 'open-settings' }
  | { type: 'pin'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }
  | { type: 'close-others'; id: string }
  | { type: 'close-all' }
  | { type: 'move'; id: string; targetId: string; side: 'before' | 'after' }
  | { type: 'sync-items'; entries: ItemEntry[] };

function pinTab(tabs: Tab[], id: string): Tab[] {
  return tabs.map((t): Tab => {
    if (t.id !== id || t.kind !== 'item') return t;
    return { ...t, preview: false };
  });
}

export function reduce(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open-item': {
      const id = `item:${action.itemKey}`;
      // Match by itemKey, not id: a re-keyed tab (see `sync-items`)
      // keeps its original id, and opening its item again must find it
      // rather than spawn a duplicate.
      //
      // …and match by id as well, for the mirror case: a tab opened as
      // `branch:x` and since re-keyed to `pr:n` still carries the id
      // `item:branch:x`, so opening `branch:x` again — which the
      // palette does whenever the branch isn't in the sidebar model yet
      // — would otherwise create a second tab sharing that id. Panes
      // are keyed by tab id, so two of them render each other's
      // content and closing one acts on the wrong tab.
      const existing = state.tabs.find(
        (t) =>
          t.kind === 'item' && (t.itemKey === action.itemKey || t.id === id)
      );
      if (existing) {
        const tabs = action.preview
          ? state.tabs
          : pinTab(state.tabs, existing.id);
        return { ...state, tabs, activeId: existing.id };
      }
      const next: Tab = {
        id,
        kind: 'item',
        itemKey: action.itemKey,
        preview: action.preview,
      };
      // Replace the current preview tab (if any) instead of stacking.
      const previewIdx = state.tabs.findIndex((t) => t.preview);
      if (action.preview && previewIdx >= 0) {
        const tabs = [...state.tabs];
        tabs[previewIdx] = next;
        return { ...state, tabs, activeId: id };
      }
      return { ...state, tabs: [...state.tabs, next], activeId: id };
    }
    case 'open-settings': {
      if (state.tabs.some((t) => t.id === 'settings')) {
        return { ...state, activeId: 'settings' };
      }
      return {
        ...state,
        tabs: [
          ...state.tabs,
          { id: 'settings', kind: 'settings', preview: false },
        ],
        activeId: 'settings',
      };
    }
    case 'pin':
      return { ...state, tabs: pinTab(state.tabs, action.id) };
    case 'activate':
      return state.tabs.some((t) => t.id === action.id)
        ? { ...state, activeId: action.id }
        : state;
    case 'close': {
      const idx = state.tabs.findIndex((t) => t.id === action.id);
      if (idx < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.id);
      let activeId = state.activeId;
      if (state.activeId === action.id) {
        const neighbour = tabs[Math.min(idx, tabs.length - 1)];
        activeId = neighbour?.id ?? null;
      }
      return { ...state, tabs, activeId };
    }
    case 'close-others': {
      const tabs = state.tabs.filter((t) => t.id === action.id);
      return { ...state, tabs, activeId: tabs[0]?.id ?? null };
    }
    case 'close-all':
      // `autoOpened` survives on purpose: closing every tab is a manual
      // act, and re-opening the running agents on the next sidebar poll
      // would undo it.
      return { ...state, tabs: [], activeId: null };
    case 'move': {
      if (action.id === action.targetId) return state;
      const from = state.tabs.findIndex((t) => t.id === action.id);
      if (from < 0) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      const at = tabs.findIndex((t) => t.id === action.targetId);
      if (at < 0) return state;
      tabs.splice(action.side === 'after' ? at + 1 : at, 0, moved);
      return { ...state, tabs };
    }
    case 'sync-items':
      return pinLive(
        autoOpenRunning(
          rekey(state, action.entries),
          action.entries,
          // The strip as the user last saw it. Auto-open's already-open
          // guard is a question about history, and re-keying is not
          // part of the history it asks about — see `autoOpenRunning`.
          state.tabs
        ),
        action.entries
      );
  }
}

/**
 * Follow items whose key changed identity, and collapse any duplicate
 * the change produced.
 */
function rekey(state: TabsState, entries: ItemEntry[]): TabsState {
  // Reconcile open tabs with the current sidebar items. An item's
  // key changes identity over its life (worktree `branch:x` grows a
  // PR and becomes `pr:n`; a closed PR reverts) — follow it by
  // branch so the tab never strands on a key no item carries.
  const branchOf = new Map<string, string>();
  const keys = new Set<string>();
  for (const e of entries) {
    keys.add(e.itemKey);
    // On a branch collision prefer the PR-bearing key — it is the
    // newer identity (the sidebar keys any PR-bearing item by PR).
    const prev = branchOf.get(e.branch);
    if (!prev || (prev.startsWith('branch:') && e.itemKey.startsWith('pr:')))
      branchOf.set(e.branch, e.itemKey);
  }
  const entryBranch = new Map(entries.map((e) => [e.itemKey, e.branch]));
  let changed = false;
  const remapped = state.tabs.map((t): Tab => {
    if (t.kind !== 'item') return t;
    if (keys.has(t.itemKey)) {
      const branch = entryBranch.get(t.itemKey);
      if (branch && t.branch !== branch) {
        changed = true;
        return { ...t, branch };
      }
      return t;
    }
    // Stale key. `branch:`-shaped keys carry their branch; older
    // tabs may have a stamped one from a previous sync.
    const branch =
      t.branch ??
      (t.itemKey.startsWith('branch:') ? t.itemKey.slice(7) : undefined);
    const nextKey = branch ? branchOf.get(branch) : undefined;
    if (!nextKey || nextKey === t.itemKey) return t;
    changed = true;
    return { ...t, itemKey: nextKey, branch };
  });
  if (!changed) return state;
  // Re-keying can collide with a tab already open on the new key
  // (the user opened the PR by hand while the worktree tab was
  // stranded). Keep the leftmost, let the survivor inherit pinned
  // state, and follow the active tab to the survivor.
  const seen = new Map<string, Tab>();
  const tabs: Tab[] = [];
  let activeId = state.activeId;
  for (const t of remapped) {
    const key = t.kind === 'item' ? t.itemKey : t.id;
    const survivor = seen.get(key);
    if (!survivor) {
      seen.set(key, t);
      tabs.push(t);
      continue;
    }
    if (survivor.kind === 'item' && !t.preview && survivor.preview) {
      const idx = tabs.indexOf(survivor);
      const pinned: Tab = { ...survivor, preview: false };
      tabs[idx] = pinned;
      seen.set(key, pinned);
    }
    if (activeId === t.id) activeId = survivor.id;
  }
  return { ...state, tabs, activeId };
}

/**
 * Every running agent gets a tab: restores the tabs for tmux sessions
 * that survived a restart, and surfaces sessions started elsewhere.
 *
 * Each session is auto-opened at most once — recorded in `autoOpened`,
 * which is why a tab the user closes stays closed while the sidebar
 * keeps reporting the agent — and never when a tab for its key is
 * already open, so this can't steal focus from what the user is
 * looking at either.
 *
 * `openTabs` answers that already-open question, and it is the strip
 * *before* `rekey` ran, not after. The two differ only where re-keying
 * collapsed a duplicate onto the survivor: the tab carrying the id
 * `item:<key>` is gone from the new strip, but it was open, and the
 * collapse was bookkeeping rather than the user closing anything.
 * Asking the post-rekey strip answers "no tab" there, and the
 * `open-item` that follows finds the survivor by its itemKey and
 * activates it — moving the focus off whatever the user had in front
 * of them, on a sidebar poll they never asked for.
 */
function autoOpenRunning(
  state: TabsState,
  entries: ItemEntry[],
  openTabs: readonly Tab[]
): TabsState {
  const opened = new Set(state.autoOpened);
  let next = state;
  let changed = false;
  for (const e of entries) {
    if (!e.running || !e.sessionName) continue;
    if (opened.has(e.sessionName)) continue;
    opened.add(e.sessionName);
    changed = true;
    if (openTabs.some((t) => t.id === `item:${e.itemKey}`)) continue;
    next = reduce(next, {
      type: 'open-item',
      itemKey: e.itemKey,
      preview: false,
    });
  }
  return changed ? { ...next, autoOpened: [...opened] } : next;
}

/**
 * A preview tab whose branch has a live agent is active work, not idle
 * browsing: pin it so preview replacement (clicking another sidebar
 * item) can never swallow the tab out from under the agent.
 *
 * Liveness is `running`, not the presence of a session *name*: every
 * worktree item carries a name whether or not an agent was ever
 * started, so keying off the name pinned every preview tab the moment
 * it opened and preview replacement never happened.
 */
function pinLive(state: TabsState, entries: ItemEntry[]): TabsState {
  const branchOf = new Map(entries.map((e) => [e.itemKey, e.branch]));
  const live = new Set(entries.filter((e) => e.running).map((e) => e.branch));
  if (live.size === 0) return state;
  let changed = false;
  const tabs = state.tabs.map((t): Tab => {
    if (t.kind !== 'item' || !t.preview) return t;
    const branch = branchOf.get(t.itemKey);
    if (!branch || !live.has(branch)) return t;
    changed = true;
    return { ...t, preview: false };
  });
  return changed ? { ...state, tabs } : state;
}
