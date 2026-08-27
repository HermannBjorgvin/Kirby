import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

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

/** One sidebar item as the tab model needs it: its current key and branch. */
export interface ItemEntry {
  itemKey: string;
  branch: string;
}

export interface TabsState {
  tabs: Tab[];
  activeId: string | null;
}

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
      const existing = state.tabs.find(
        (t) => t.kind === 'item' && t.itemKey === action.itemKey
      );
      if (existing) {
        const tabs = action.preview
          ? state.tabs
          : pinTab(state.tabs, existing.id);
        return { tabs, activeId: existing.id };
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
        return { tabs, activeId: id };
      }
      return { tabs: [...state.tabs, next], activeId: id };
    }
    case 'open-settings': {
      if (state.tabs.some((t) => t.id === 'settings')) {
        return { ...state, activeId: 'settings' };
      }
      return {
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
      return { tabs, activeId };
    }
    case 'close-others': {
      const tabs = state.tabs.filter((t) => t.id === action.id);
      return { tabs, activeId: tabs[0]?.id ?? null };
    }
    case 'close-all':
      return { tabs: [], activeId: null };
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
    case 'sync-items': {
      // Reconcile open tabs with the current sidebar items. An item's
      // key changes identity over its life (worktree `branch:x` grows a
      // PR and becomes `pr:n`; a closed PR reverts) — follow it by
      // branch so the tab never strands on a key no item carries.
      const branchOf = new Map<string, string>();
      const keys = new Set<string>();
      for (const e of action.entries) {
        keys.add(e.itemKey);
        // On a branch collision prefer the PR-bearing key — it is the
        // newer identity (the sidebar keys any PR-bearing item by PR).
        const prev = branchOf.get(e.branch);
        if (
          !prev ||
          (prev.startsWith('branch:') && e.itemKey.startsWith('pr:'))
        )
          branchOf.set(e.branch, e.itemKey);
      }
      const entryBranch = new Map(
        action.entries.map((e) => [e.itemKey, e.branch])
      );
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
      return { tabs, activeId };
    }
  }
}

interface TabsApi extends TabsState {
  openItem: (itemKey: string, opts?: { preview?: boolean }) => void;
  openSettings: () => void;
  pin: (id: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeAll: () => void;
  closeActive: () => void;
  /** Activate the next (+1) / previous (-1) tab, wrapping around. */
  cycle: (delta: 1 | -1) => void;
  /** Drag-reorder: place `id` before/after `targetId`. */
  moveTab: (id: string, targetId: string, side: 'before' | 'after') => void;
  /** Reconcile tab keys/branches with the current sidebar items. */
  syncItems: (entries: ItemEntry[]) => void;
}

const TabsContext = createContext<TabsApi | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, { tabs: [], activeId: null });

  const openItem = useCallback(
    (itemKey: string, opts?: { preview?: boolean }) =>
      dispatch({ type: 'open-item', itemKey, preview: opts?.preview ?? false }),
    []
  );
  const openSettings = useCallback(
    () => dispatch({ type: 'open-settings' }),
    []
  );
  const pin = useCallback((id: string) => dispatch({ type: 'pin', id }), []);
  const activate = useCallback(
    (id: string) => dispatch({ type: 'activate', id }),
    []
  );
  const close = useCallback(
    (id: string) => dispatch({ type: 'close', id }),
    []
  );
  const closeOthers = useCallback(
    (id: string) => dispatch({ type: 'close-others', id }),
    []
  );
  const closeAll = useCallback(() => dispatch({ type: 'close-all' }), []);
  const closeActive = useCallback(() => {
    if (state.activeId) dispatch({ type: 'close', id: state.activeId });
  }, [state.activeId]);
  const cycle = useCallback(
    (delta: 1 | -1) => {
      const { tabs, activeId } = state;
      if (tabs.length < 2) return;
      const idx = tabs.findIndex((t) => t.id === activeId);
      const next = tabs[(idx + delta + tabs.length) % tabs.length];
      dispatch({ type: 'activate', id: next.id });
    },
    [state]
  );
  const moveTab = useCallback(
    (id: string, targetId: string, side: 'before' | 'after') =>
      dispatch({ type: 'move', id, targetId, side }),
    []
  );
  const syncItems = useCallback(
    (entries: ItemEntry[]) => dispatch({ type: 'sync-items', entries }),
    []
  );

  const api = useMemo<TabsApi>(
    () => ({
      ...state,
      openItem,
      openSettings,
      pin,
      activate,
      close,
      closeOthers,
      closeAll,
      closeActive,
      cycle,
      moveTab,
      syncItems,
    }),
    [
      state,
      openItem,
      openSettings,
      pin,
      activate,
      close,
      closeOthers,
      closeAll,
      closeActive,
      cycle,
      moveTab,
      syncItems,
    ]
  );

  return <TabsContext.Provider value={api}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsApi {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within TabsProvider');
  return ctx;
}
