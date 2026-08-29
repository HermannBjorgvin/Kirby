import { useSyncExternalStore } from 'react';
import {
  add,
  annotate,
  clear,
  count,
  getPlanSnapshot,
  has,
  list,
  removePlanItem,
  subscribePlanStore,
  toggle,
} from '@kirby/core';

/**
 * React binding for the plan store. The store itself is shell-agnostic
 * and lives in @kirby/core; this is the only part of it that needs
 * React, which is why the two are in different libraries.
 */
export function usePlanStore() {
  const snapshot = useSyncExternalStore(subscribePlanStore, getPlanSnapshot);
  return {
    snapshot,
    add,
    remove: removePlanItem,
    has,
    toggle,
    annotate,
    list,
    count,
    clear,
  };
}
