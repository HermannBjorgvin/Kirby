import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useStdout } from 'ink';
import { useNavigation } from '../hooks/useNavigation.js';
import { useAsyncOperation } from '../hooks/useAsyncOperation.js';
import { useSettings } from '../hooks/useSettings.js';
import { useBranchPicker } from '../hooks/useBranchPicker.js';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation.js';

export interface AppStateContextValue {
  nav: ReturnType<typeof useNavigation>;
  asyncOps: ReturnType<typeof useAsyncOperation>;
  settings: ReturnType<typeof useSettings>;
  branchPicker: ReturnType<typeof useBranchPicker>;
  deleteConfirm: ReturnType<typeof useDeleteConfirmation>;
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
