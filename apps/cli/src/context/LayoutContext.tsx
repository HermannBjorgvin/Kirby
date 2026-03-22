import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTerminalDimensions } from '../hooks/useTerminalDimensions.js';

const SIDEBAR_WIDTH = 48;

export interface TerminalLayout {
  paneCols: number;
  paneRows: number;
}

export interface LayoutContextValue {
  terminal: TerminalLayout;
  sidebarWidth: number;
  termRows: number;
  termCols: number;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const { rows: termRows, cols: termCols } = useTerminalDimensions();

  const paneCols = Math.max(20, termCols - SIDEBAR_WIDTH - 2);
  const paneRows = Math.max(5, termRows - 5);

  const terminal = useMemo(
    () => ({ paneCols, paneRows }),
    [paneCols, paneRows]
  );

  const value = useMemo<LayoutContextValue>(
    () => ({ terminal, sidebarWidth: SIDEBAR_WIDTH, termRows, termCols }),
    [terminal, termRows, termCols]
  );

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
}

export function useLayout(): LayoutContextValue {
  const ctx = useContext(LayoutContext);
  if (!ctx) throw new Error('useLayout must be used within LayoutProvider');
  return ctx;
}
