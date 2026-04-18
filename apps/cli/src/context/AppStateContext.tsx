import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigation } from '../hooks/useNavigation.js';
import { useAsyncOperation } from '../hooks/useAsyncOperation.js';

/** UI state shared across all tabs (navigation, async ops). */
export interface AppStateContextValue {
  /** Active tab and focus (sidebar vs terminal). */
  nav: ReturnType<typeof useNavigation>;
  /** Serialized async operation runner (prevents concurrent mutations). */
  asyncOps: ReturnType<typeof useAsyncOperation>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const nav = useNavigation();
  const asyncOps = useAsyncOperation();

  const value = useMemo<AppStateContextValue>(
    () => ({ nav, asyncOps }),
    [nav, asyncOps]
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
