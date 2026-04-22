import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useAsyncOperation } from '../hooks/useAsyncOperation.js';
import type { OperationName } from '../hooks/useAsyncOperation.js';

export interface AsyncOpsValue {
  run: (name: OperationName, fn: () => Promise<void>) => Promise<void>;
  isRunning: (name: OperationName) => boolean;
  inFlight: Set<OperationName>;
}

// Single-context: the whole API is small (run/isRunning/inFlight) and
// consumers generally read inFlight for the indicator + call run from
// input handlers. Splitting state/actions would save zero re-renders
// since the only state is inFlight.
const AsyncOpsContext = createContext<AsyncOpsValue | null>(null);

export function AsyncOpsProvider({ children }: { children: ReactNode }) {
  const value = useAsyncOperation();
  return (
    <AsyncOpsContext.Provider value={value}>
      {children}
    </AsyncOpsContext.Provider>
  );
}

export function useAsyncOps(): AsyncOpsValue {
  const ctx = useContext(AsyncOpsContext);
  if (!ctx) throw new Error('useAsyncOps must be used within AsyncOpsProvider');
  return ctx;
}
