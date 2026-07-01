import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { usePlanStore } from '../plan/plan-store.js';
import type { PlanItem } from '../plan/plan-types.js';

export interface PlanValue {
  /** Reactive snapshot — read to subscribe; mutate via the methods. */
  snapshot: ReadonlyMap<number, PlanItem[]>;
  add: (prId: number, item: PlanItem) => void;
  remove: (prId: number, kind: PlanItem['kind'], id: string) => void;
  has: (prId: number, kind: PlanItem['kind'], id: string) => boolean;
  toggle: (prId: number, item: PlanItem) => boolean;
  annotate: (
    prId: number,
    kind: PlanItem['kind'],
    id: string,
    annotation: string
  ) => void;
  list: (prId: number) => PlanItem[];
  count: (prId: number) => number;
  clear: (prId: number) => void;
}

// Single-context: the API is small and the only reactive state is the
// snapshot Map. Mirrors AsyncOpsContext — consumers read the snapshot
// for the indicator and call the imperative methods from input handlers.
const PlanContext = createContext<PlanValue | null>(null);

export function PlanProvider({ children }: { children: ReactNode }) {
  const value = usePlanStore();
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within PlanProvider');
  return ctx;
}
