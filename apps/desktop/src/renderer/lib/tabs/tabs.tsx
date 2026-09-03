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
  type TerminalEntry,
} from './tabs-model.js';
import { useRepo } from '../repo-context.js';

export type {
  ItemEntry,
  ItemTab,
  Tab,
  TabsAction,
  TabsState,
  TerminalEntry,
  TerminalTab,
} from './tabs-model.js';
export { activeTabRepo } from './tabs-model.js';
export {
  foreignRepoOf,
  isForeignTab,
  itemTabId,
  terminalTabId,
} from './tab-identity.js';

/**
 * The tab strip's api.
 *
 * `openItem` and `syncItems` name the repository they act on, because
 * the provider sits *above* the repo gate — the strip keeps another
 * repository's tabs after you switch away, so it cannot assume every
 * action is about the repo that happens to be open. Components inside
 * a repo workspace use `useRepoTabs`, which fills the repo in.
 */
interface TabsApi extends TabsState {
  openItem: (
    repo: string,
    itemKey: string,
    opts?: { preview?: boolean }
  ) => void;
  openSettings: () => void;
  pin: (id: string) => void;
  activate: (id: string) => void;
  /** `repo` is the one in view: focus never leaves it on a close. */
  close: (id: string, repo?: string) => void;
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
  syncItems: (repo: string, entries: ItemEntry[]) => void;
  /** Tell the strip a repository is now the one in view. */
  repoOpened: (repo: string) => void;
  /** Open (or activate) the tab for a terminal the host just started. */
  openTerminal: (terminal: TerminalEntry) => void;
  /** Reconcile the strip with the host's terminal listing. */
  syncTerminals: (terminals: TerminalEntry[]) => void;
}

const TabsContext = createContext<TabsApi | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, EMPTY_TABS);

  const openItem = useCallback(
    (repo: string, itemKey: string, opts?: { preview?: boolean }) =>
      dispatch({
        type: 'open-item',
        repo,
        itemKey,
        preview: opts?.preview ?? false,
      }),
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
    (id: string, repo?: string) => dispatch({ type: 'close', id, repo }),
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
    (repo: string, entries: ItemEntry[]) =>
      dispatch({ type: 'sync-items', repo, entries }),
    []
  );
  const repoOpened = useCallback(
    (repo: string) => dispatch({ type: 'repo-opened', repo }),
    []
  );
  const openTerminal = useCallback(
    (terminal: TerminalEntry) => dispatch({ type: 'open-terminal', terminal }),
    []
  );
  const syncTerminals = useCallback(
    (terminals: TerminalEntry[]) =>
      dispatch({ type: 'sync-terminals', terminals }),
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
      repoOpened,
      openTerminal,
      syncTerminals,
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
      repoOpened,
      openTerminal,
      syncTerminals,
    ]
  );

  return <TabsContext.Provider value={api}>{children}</TabsContext.Provider>;
}

export function useTabs(): TabsApi {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('useTabs must be used within TabsProvider');
  return ctx;
}

/** Repo-scoped api for everything rendered inside a repo workspace: the
 *  same tabs, with `openItem`/`syncItems` bound to the open repo. */
export function useRepoTabs(): RepoTabsApi {
  const { repo } = useRepo();
  const tabs = useTabs();
  const cwd = repo.cwd;
  return useMemo(
    () => ({
      ...tabs,
      openItem: (itemKey: string, opts?: { preview?: boolean }) =>
        tabs.openItem(cwd, itemKey, opts),
      syncItems: (entries: ItemEntry[]) => tabs.syncItems(cwd, entries),
      close: (id: string) => tabs.close(id, cwd),
    }),
    [tabs, cwd]
  );
}

export interface RepoTabsApi extends Omit<TabsApi, 'openItem' | 'syncItems'> {
  openItem: (itemKey: string, opts?: { preview?: boolean }) => void;
  syncItems: (entries: ItemEntry[]) => void;
}
