import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  EMPTY_TABS,
  reduce,
  type ItemEntry,
  type TabsState,
} from './tabs-model.js';

export type { ItemEntry, Tab, TabsAction, TabsState } from './tabs-model.js';

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
  /**
   * Reconcile the strip with the current sidebar items, in one step:
   * follow re-keyed items, open a tab for each newly running agent,
   * and pin any preview tab that now has a live agent behind it.
   */
  syncItems: (entries: ItemEntry[]) => void;
}

const TabsContext = createContext<TabsApi | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, EMPTY_TABS);

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
