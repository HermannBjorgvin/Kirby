import { pairKey } from './tab-identity.js';
import type { ItemEntry, ItemTab, Tab, TabsState } from './tabs-model.js';

/**
 * The passes `sync-items` runs over tabs that already exist:
 * following an item whose key changed identity, collapsing the
 * duplicate that can produce, and pinning a preview that turned out
 * to have a live agent behind it.
 *
 * Each is scoped to the repository being synced — another repo's
 * tabs are not described by these entries, and a same-named branch
 * over there is a different branch. Opening a tab per newly running
 * agent stays with the reducer, since it is the one pass that
 * dispatches rather than rewrites.
 */

/**
 * Follow items whose key changed identity, and collapse any duplicate
 * the change produced.
 */
export function rekey(
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
  const entryByKey = new Map(entries.map((e) => [e.itemKey, e]));
  let changed = false;
  const remapped = state.tabs.map((t): Tab => {
    // Another repository's tabs are none of this sync's business: its
    // items are not in `entries`, so every one of them would read as a
    // stale key and get followed onto a same-named branch over here.
    if (t.kind !== 'item' || t.repo !== repo) return t;
    if (keys.has(t.itemKey)) {
      const stamped = stamp(t, entryByKey.get(t.itemKey));
      if (stamped !== t) changed = true;
      return stamped;
    }
    // Stale key. `branch:`-shaped keys carry their branch; older
    // tabs may have a stamped one from a previous sync.
    const branch =
      t.branch ??
      (t.itemKey.startsWith('branch:') ? t.itemKey.slice(7) : undefined);
    const nextKey = branch ? branchOf.get(branch) : undefined;
    if (!nextKey || nextKey === t.itemKey) return t;
    changed = true;
    return stamp({ ...t, itemKey: nextKey, branch }, entryByKey.get(nextKey));
  });
  if (!changed) return state;
  return { ...state, ...collapseDuplicateKeys(remapped, state.activeId) };
}

/**
 * Remember on the tab what its item says about itself — branch and
 * title — so the strip can still describe the tab once the item is out
 * of reach. Returns the same tab when nothing changed, so a quiet poll
 * does not re-render the strip.
 */
function stamp(tab: ItemTab, entry: ItemEntry | undefined): ItemTab {
  if (!entry) return tab;
  const branch = entry.branch || tab.branch;
  const title = entry.title ?? tab.title;
  if (branch === tab.branch && title === tab.title) return tab;
  return { ...tab, branch, title };
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
 * A preview tab whose branch has a live agent is active work, not idle
 * browsing: pin it so preview replacement (clicking another sidebar
 * item) can never swallow the tab out from under the agent.
 *
 * Liveness is `running`, not the presence of a session *name*: every
 * worktree item carries a name whether or not an agent was ever
 * started, so keying off the name pinned every preview tab the moment
 * it opened and preview replacement never happened.
 */
export function pinLive(
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
