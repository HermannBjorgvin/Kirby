/**
 * Editor-area tab model (VS Code semantics, simplified):
 *   • `item` tabs are keyed by *repository plus* sidebar item key; one
 *     tab per item.
 *   • A single-click opens a *preview* tab (italic title) that gets
 *     replaced by the next preview in the same repository;
 *     double-click or any interaction pins it.
 *   • `settings` is a singleton tab, and belongs to no repository.
 *
 * The strip outlives the open repository: opening another repo leaves
 * the previous one's tabs in place so their agents stay in sight. Every
 * action that names a repository therefore carries it explicitly, and
 * `sync-items` only ever reconciles the tabs of the repo it was given —
 * two repos routinely share branch names and so share item keys.
 */
export type Tab =
  | {
      id: string;
      kind: 'item';
      /** Absolute path of the repository this tab belongs to. Half of
       *  the tab's identity: `branch:main` means a different thing in
       *  each open repo. */
      repo: string;
      itemKey: string;
      preview: boolean;
      /** Last-known git branch, stamped by `sync-items`. The stable
       *  identity a tab falls back on when its itemKey goes stale —
       *  a worktree's key changes from `branch:x` to `pr:n` the moment
       *  a PR appears (and back when it closes). */
      branch?: string;
    }
  | { id: 'settings'; kind: 'settings'; preview: false };

/** A tab that shows a sidebar item, and so belongs to a repository. */
export type ItemTab = Extract<Tab, { kind: 'item' }>;

/**
 * The id of the tab for `itemKey` in `repo`.
 *
 * Length-prefixed rather than joined on a separator: repository paths
 * and branch names can both contain any punctuation a separator might
 * use, and a collision here is two repos' tabs rendering each other's
 * pane (panes are keyed by tab id).
 */
export function itemTabId(repo: string, itemKey: string): string {
  return `item:${repo.length}:${repo}:${itemKey}`;
}

/** Identity of an item tab as a map key — the same pair, unambiguous. */
function pairKey(tab: Tab): string {
  return tab.kind === 'item' ? itemTabId(tab.repo, tab.itemKey) : tab.id;
}

/** Whether `tab` belongs to a repository other than the open one.
 *  Settings belongs to none, so it is never foreign. */
export function isForeignTab(tab: Tab, repo: string): boolean {
  return foreignRepoOf(tab, repo) !== null;
}

/** The other repository `tab` belongs to, or null when it is at home. */
export function foreignRepoOf(tab: Tab, repo: string): string | null {
  return tab.kind === 'item' && tab.repo !== repo ? tab.repo : null;
}

/** The repository the active tab belongs to, if it belongs to one. */
export function activeTabRepo(state: TabsState): string | null {
  const active = state.tabs.find((t) => t.id === state.activeId);
  return active?.kind === 'item' ? active.repo : null;
}

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
  /** Sessions already auto-opened once by `sync-items`, as
   *  `autoOpenKey(repo, sessionName)`. History, not derivable from
   *  `tabs`: a tab the user closed and one that was never opened look
   *  identical, and only this tells them apart. Repo-qualified for the
   *  same reason tab ids are — the PTY registry keys sessions by bare
   *  branch name, so two repos' agents share a name. */
  autoOpened: readonly string[];
  /** The tab each repository was last looked at on, by repo root. Lets
   *  opening a repository again land where it was left rather than on
   *  whichever of its tabs happens to be rightmost. */
  lastActiveByRepo: Readonly<Record<string, string>>;
}

/** Identity of an auto-opened session, unique across repositories. */
export function autoOpenKey(repo: string, sessionName: string): string {
  return `${repo.length}:${repo}:${sessionName}`;
}

export const EMPTY_TABS: TabsState = {
  tabs: [],
  activeId: null,
  autoOpened: [],
  lastActiveByRepo: {},
};

export type TabsAction =
  | { type: 'open-item'; repo: string; itemKey: string; preview: boolean }
  | { type: 'open-settings' }
  | { type: 'pin'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }
  | { type: 'close-others'; id: string }
  | { type: 'close-all' }
  | { type: 'move'; id: string; targetId: string; side: 'before' | 'after' }
  | { type: 'sync-items'; repo: string; entries: ItemEntry[] }
  /** A repository was opened. Dispatched for every open, tab-driven or
   *  not; it only does something when the tab in front of the user
   *  belongs to somewhere else. */
  | { type: 'repo-opened'; repo: string };

function pinTab(tabs: Tab[], id: string): Tab[] {
  return tabs.map((t): Tab => {
    if (t.id !== id || t.kind !== 'item') return t;
    return { ...t, preview: false };
  });
}

/** Activate a tab, ignoring an id that is no longer on the strip. */
function activateTab(state: TabsState, id: string): TabsState {
  return state.tabs.some((t) => t.id === id)
    ? { ...state, activeId: id }
    : state;
}

/** Keep only `id`; whatever survives becomes active. */
function closeOtherTabs(state: TabsState, id: string): TabsState {
  const tabs = state.tabs.filter((t) => t.id === id);
  return { ...state, tabs, activeId: tabs[0]?.id ?? null };
}

export function reduce(state: TabsState, action: TabsAction): TabsState {
  return remember(apply(state, action));
}

/**
 * Note which tab the active repository was left on.
 *
 * Derived rather than dispatched, so no action can forget to do it —
 * every path that moves `activeId` passes through here.
 */
function remember(state: TabsState): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active?.kind !== 'item') return state;
  if (state.lastActiveByRepo[active.repo] === active.id) return state;
  return {
    ...state,
    lastActiveByRepo: { ...state.lastActiveByRepo, [active.repo]: active.id },
  };
}

/**
 * Show the repository that was just opened rather than the tab the user
 * was on before, when that tab belongs to somewhere else.
 *
 * Without this, switching repositories leaves the previous repo's tab
 * active — so the workspace you asked for opens onto a pane explaining
 * that it belongs to the one you left. A repo with no tabs of its own
 * goes to no active tab at all, which is the editor's empty state, with
 * the other repositories' tabs still on the strip.
 *
 * The settings tab is nobody's, so it survives a repo change.
 */
function focusRepo(state: TabsState, repo: string): TabsState {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active && !isForeignTab(active, repo)) return state;
  const remembered = state.tabs.find(
    (t) => t.id === state.lastActiveByRepo[repo]
  );
  const own =
    remembered ??
    [...state.tabs].reverse().find((t) => t.kind === 'item' && t.repo === repo);
  const activeId = own?.id ?? null;
  return activeId === state.activeId ? state : { ...state, activeId };
}

function apply(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open-item':
      return openItem(state, action.repo, action.itemKey, action.preview);
    case 'open-settings':
      return openSettings(state);
    case 'pin':
      return { ...state, tabs: pinTab(state.tabs, action.id) };
    case 'activate':
      return activateTab(state, action.id);
    case 'close':
      return closeTab(state, action.id);
    case 'close-others':
      return closeOtherTabs(state, action.id);
    case 'close-all':
      // `autoOpened` survives on purpose: closing every tab is a manual
      // act, and re-opening the running agents on the next sidebar poll
      // would undo it.
      return { ...state, tabs: [], activeId: null };
    case 'move':
      return moveTab(state, action.id, action.targetId, action.side);
    case 'sync-items':
      return pinLive(
        autoOpenRunning(
          rekey(state, action.repo, action.entries),
          action.repo,
          action.entries,
          // The strip as the user last saw it. Auto-open's already-open
          // guard is a question about history, and re-keying is not
          // part of the history it asks about — see `autoOpenRunning`.
          state.tabs
        ),
        action.repo,
        action.entries
      );
    case 'repo-opened':
      return focusRepo(state, action.repo);
  }
}

/**
 * Activate the tab for an item, opening one if none is on it yet.
 *
 * The search matches by itemKey, not id: a re-keyed tab (see
 * `sync-items`) keeps its original id, and opening its item again must
 * find it rather than spawn a duplicate.
 *
 * …and by id as well, for the mirror case: a tab opened as `branch:x`
 * and since re-keyed to `pr:n` still carries the id it was opened with,
 * so opening `branch:x` again — which the palette does whenever the
 * branch isn't in the sidebar model yet — would otherwise create a
 * second tab sharing that id. Panes are keyed by tab id, so two of them
 * render each other's content and closing one acts on the wrong tab.
 *
 * Both searches are confined to `repo`: the same item key in another
 * repository is a different item, and matching it would hand this
 * repo's click to a tab pointing at someone else's branch.
 */
function openItem(
  state: TabsState,
  repo: string,
  itemKey: string,
  preview: boolean
): TabsState {
  const id = itemTabId(repo, itemKey);
  const existing = state.tabs.find(
    (t) =>
      t.kind === 'item' &&
      t.repo === repo &&
      (t.itemKey === itemKey || t.id === id)
  );
  if (existing) {
    const tabs = preview ? state.tabs : pinTab(state.tabs, existing.id);
    return { ...state, tabs, activeId: existing.id };
  }
  const next: Tab = { id, kind: 'item', repo, itemKey, preview };
  // Replace this repo's preview tab (if any) instead of stacking.
  // Scoped to the repo: another repository's preview tab is a tab the
  // user can no longer see, and swallowing it on a click over here
  // would delete work in a window they are not looking at.
  const previewIdx = state.tabs.findIndex(
    (t) => t.preview && t.kind === 'item' && t.repo === repo
  );
  if (preview && previewIdx >= 0) {
    const tabs = [...state.tabs];
    tabs[previewIdx] = next;
    return { ...state, tabs, activeId: id };
  }
  return { ...state, tabs: [...state.tabs, next], activeId: id };
}

/** Settings is a singleton tab: open it once, activate it thereafter. */
function openSettings(state: TabsState): TabsState {
  if (state.tabs.some((t) => t.id === 'settings')) {
    return { ...state, activeId: 'settings' };
  }
  return {
    ...state,
    tabs: [...state.tabs, { id: 'settings', kind: 'settings', preview: false }],
    activeId: 'settings',
  };
}

/**
 * Drop a tab, and when it was the active one hand focus to the tab that
 * slid into its place (the last tab, if it was the rightmost).
 */
function closeTab(state: TabsState, id: string): TabsState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (state.activeId === id) {
    const neighbour = tabs[Math.min(idx, tabs.length - 1)];
    activeId = neighbour?.id ?? null;
  }
  return { ...state, tabs, activeId };
}

/** Drag-reorder: lift a tab out of the strip and drop it beside another. */
function moveTab(
  state: TabsState,
  id: string,
  targetId: string,
  side: 'before' | 'after'
): TabsState {
  if (id === targetId) return state;
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from < 0) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  const at = tabs.findIndex((t) => t.id === targetId);
  if (at < 0) return state;
  tabs.splice(side === 'after' ? at + 1 : at, 0, moved);
  return { ...state, tabs };
}

/**
 * Follow items whose key changed identity, and collapse any duplicate
 * the change produced.
 */
function rekey(
  state: TabsState,
  repo: string,
  entries: ItemEntry[]
): TabsState {
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
    // Another repository's tabs are none of this sync's business: its
    // items are not in `entries`, so every one of them would read as a
    // stale key and get followed onto a same-named branch over here.
    if (t.kind !== 'item' || t.repo !== repo) return t;
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
  return { ...state, ...collapseDuplicateKeys(remapped, state.activeId) };
}

/**
 * Re-keying can land two tabs on the same key — the user opened the PR
 * by hand while the worktree tab was stranded on `branch:x`. Keep the
 * leftmost, let the survivor inherit pinned state (a pin is a
 * deliberate act and must not be lost to bookkeeping), and follow the
 * active tab to the survivor so focus does not fall off the strip.
 */
function collapseDuplicateKeys(
  remapped: readonly Tab[],
  startingActiveId: string | null
): { tabs: Tab[]; activeId: string | null } {
  const seen = new Map<string, Tab>();
  const tabs: Tab[] = [];
  let activeId = startingActiveId;
  for (const t of remapped) {
    const key = pairKey(t);
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
  return { tabs, activeId };
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
  repo: string,
  entries: ItemEntry[],
  openTabs: readonly Tab[]
): TabsState {
  const opened = new Set(state.autoOpened);
  let next = state;
  let changed = false;
  for (const e of entries) {
    if (!e.running || !e.sessionName) continue;
    const seenKey = autoOpenKey(repo, e.sessionName);
    if (opened.has(seenKey)) continue;
    opened.add(seenKey);
    changed = true;
    if (openTabs.some((t) => t.id === itemTabId(repo, e.itemKey))) continue;
    next = reduce(next, {
      type: 'open-item',
      repo,
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
function pinLive(
  state: TabsState,
  repo: string,
  entries: ItemEntry[]
): TabsState {
  const branchOf = new Map(entries.map((e) => [e.itemKey, e.branch]));
  const live = new Set(entries.filter((e) => e.running).map((e) => e.branch));
  if (live.size === 0) return state;
  let changed = false;
  const tabs = state.tabs.map((t): Tab => {
    if (t.kind !== 'item' || t.repo !== repo || !t.preview) return t;
    const branch = branchOf.get(t.itemKey);
    if (!branch || !live.has(branch)) return t;
    changed = true;
    return { ...t, preview: false };
  });
  return changed ? { ...state, tabs } : state;
}
