import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useStdout } from 'ink';
import { useNavigation } from '../hooks/useNavigation.js';
import { useAsyncOperation } from '../hooks/useAsyncOperation.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBranchPicker } from '../hooks/useBranchPicker.js';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation.js';

/** Top-level UI state shared across all tabs (navigation, modals, layout). */
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
  /** Terminal pane dimensions in rows/cols (derived from stdout minus chrome). */
  terminal: { paneCols: number; paneRows: number };
  sidebarWidth: number;
  termRows: number;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

const SIDEBAR_WIDTH = 48;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const termCols = stdout?.columns ?? 80;

  const paneCols = Math.max(20, termCols - SIDEBAR_WIDTH - 2);
  const paneRows = Math.max(5, termRows - 5);

  const nav = useNavigation();
  const asyncOps = useAsyncOperation();
  const settings = useSettings();
  const branchPicker = useBranchPicker();
  const deleteConfirm = useDeleteConfirmation();

  const terminal = useMemo(
    () => ({ paneCols, paneRows }),
    [paneCols, paneRows]
  );

  const value = useMemo<AppStateContextValue>(
    () => ({
      nav,
      asyncOps,
      settings,
      branchPicker,
      deleteConfirm,
      terminal,
      sidebarWidth: SIDEBAR_WIDTH,
      termRows,
    }),
    [nav, asyncOps, settings, branchPicker, deleteConfirm, terminal, termRows]
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
