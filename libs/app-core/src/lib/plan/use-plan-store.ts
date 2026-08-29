import { useSyncExternalStore } from 'react';
import {
  add,
  annotate,
  clear,
  count,
  getSnapshot,
  has,
  list,
  remove,
  subscribe,
  toggle,
} from '@kirby/core/plan';

/**
 * React binding for the plan store. The store itself is shell-agnostic
 * and lives in @kirby/core; this is the only part of it that needs
 * React, which is why the two are in different libraries.
 *
 * It imports the store through `@kirby/core/plan` rather than the main
 * barrel so this module stays browser-safe: the desktop renderer is a
 * sandboxed context with no Node, and reaching the barrel would pull
 * git and PTY code into its bundle. That is what lets both shells share
 * one cart rather than one each.
 */
export function usePlanStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  return {
    snapshot,
    add,
    remove,
    has,
    toggle,
    annotate,
    list,
    count,
    clear,
  };
}
