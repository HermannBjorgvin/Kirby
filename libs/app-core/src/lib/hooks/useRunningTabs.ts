import { useMemo } from 'react';
import { useSidebar } from '../context/SidebarContext.js';
import { getSpawnedAt as registryGetSpawnedAt } from '../pty-registry.js';
import {
  orderRunningTabs,
  tabNumberMap,
  type RunningSessionItem,
} from '../utils/running-tabs.js';
import type { SidebarItem } from '../types.js';

/**
 * Pure computation behind `useRunningTabs`, exported so consumers that
 * already hold the sidebar items (or test doubles) can derive the tab
 * list without a second context subscription.
 *
 * Reads `getSpawnedAt` directly from the PTY-registry module — the
 * value is per-entry-immutable, and the set of running entries already
 * propagates via React state (sidebar items rebuild when `running`
 * flips), so re-running the memo on items change is enough.
 */
export function runningTabsFromItems(
  items: SidebarItem[],
  getSpawnedAt: (name: string) => number | undefined = registryGetSpawnedAt
): {
  tabs: RunningSessionItem[];
  numbers: Map<string, number>;
} {
  const tabs = orderRunningTabs(items, getSpawnedAt);
  const numbers = tabNumberMap(tabs);
  return { tabs, numbers };
}

/**
 * Active-sessions tab list, sorted by PTY spawn time, plus a name →
 * tab-number lookup. Both the SessionTabBar and the Sidebar prefix
 * read from this so the digits always agree.
 */
export function useRunningTabs(): {
  tabs: RunningSessionItem[];
  numbers: Map<string, number>;
} {
  const { items } = useSidebar();
  return useMemo(() => runningTabsFromItems(items), [items]);
}
