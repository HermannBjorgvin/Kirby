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
  | { id: string; kind: 'item'; itemKey: string; preview: boolean }
  | { id: 'settings'; kind: 'settings'; preview: false };

interface TabsState {
  tabs: Tab[];
  activeId: string | null;
}

type Action =
  | { type: 'open-item'; itemKey: string; preview: boolean }
  | { type: 'open-settings' }
  | { type: 'pin'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'close'; id: string }
  | { type: 'close-others'; id: string }
  | { type: 'close-all' };

function pinTab(tabs: Tab[], id: string): Tab[] {
  return tabs.map((t): Tab => {
    if (t.id !== id || t.kind !== 'item') return t;
    return { ...t, preview: false };
  });
}

function reduce(state: TabsState, action: Action): TabsState {
  switch (action.type) {
    case 'open-item': {
      const id = `item:${action.itemKey}`;
      const existing = state.tabs.find((t) => t.id === id);
      if (existing) {
        const tabs = action.preview ? state.tabs : pinTab(state.tabs, id);
        return { tabs, activeId: id };
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
    ]
  );

  return <TabsContext.Provider value={api}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsApi {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within TabsProvider');
  return ctx;
}
