import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigation } from '../hooks/useNavigation.js';
import { useAsyncOperation } from '../hooks/useAsyncOperation.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBranchPicker } from '../hooks/useBranchPicker.js';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation.js';

/** UI state shared across all tabs (navigation, modals, async ops). */
export interface AppStateContextValue {
  /** Active tab and focus (sidebar vs terminal). */
  nav: ReturnType<typeof useNavigation>;
  /** Serialized async operation runner (prevents concurrent mutations). */
  asyncOps: ReturnType<typeof useAsyncOperation>;
  /** Settings panel open/close and field editing state. */
  settings: ReturnType<typeof useSettings>;
  /** Branch picker modal state (filter, selected index, branch list). */
  branchPicker: ReturnType<typeof useBranchPicker>;
  /** Delete-confirmation modal state. */
  deleteConfirm: ReturnType<typeof useDeleteConfirmation>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const nav = useNavigation();
  const asyncOps = useAsyncOperation();
  const settings = useSettings();
  const branchPicker = useBranchPicker();
  const deleteConfirm = useDeleteConfirmation();

  const value = useMemo<AppStateContextValue>(
    () => ({ nav, asyncOps, settings, branchPicker, deleteConfirm }),
    [nav, asyncOps, settings, branchPicker, deleteConfirm]
  );

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
