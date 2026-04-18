import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTerminalDimensions } from '../hooks/useTerminalDimensions.js';

// Layout constants. Exported as LAYOUT so any consumer that needs to
// recompute pane dimensions (e.g. MainTab's auto-hide sidebar override)
// reuses the same numbers instead of hardcoding its own.
//
// paneCols/paneRows below are the *interior* dimensions of the main
// pane — what the PTY and DiffViewer actually draw into. The pane
// border (2 cols + 2 rows) and title row (1 row) are already subtracted,
// so downstream consumers don't need to do any more math.
const SIDEBAR_WIDTH = 48;
const PANE_BORDER_ROWS = 2; // top + bottom border
// Titles live INSIDE the top border line (via @mishieck/ink-titled-box),
// so they don't consume a dedicated content row. Kept as a named
// constant for clarity — flip to >0 if we ever switch back to an
// above-content title.
const PANE_TITLE_ROWS = 0;
const PANE_BORDER_COLS = 2; // left + right border

export const LAYOUT = {
  SIDEBAR_WIDTH,
  PANE_BORDER_ROWS,
  PANE_TITLE_ROWS,
  PANE_BORDER_COLS,
} as const;

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

  const paneCols = Math.max(20, termCols - SIDEBAR_WIDTH - PANE_BORDER_COLS);
  const paneRows = Math.max(5, termRows - PANE_BORDER_ROWS - PANE_TITLE_ROWS);

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
