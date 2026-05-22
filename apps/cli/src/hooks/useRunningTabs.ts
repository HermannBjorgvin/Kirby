import { useMemo } from 'react';
import { useSidebar } from '../context/SidebarContext.js';
import { getSpawnedAt } from '../pty-registry.js';
import {
  orderRunningTabs,
  tabNumberMap,
  type RunningSessionItem,
} from '../utils/running-tabs.js';

/**
 * Active-sessions tab list, sorted by PTY spawn time, plus a name →
 * tab-number lookup. Both the SessionTabBar and the Sidebar prefix
 * read from this so the digits always agree.
 *
 * Reads `getSpawnedAt` directly from the PTY-registry module — the
 * value is per-entry-immutable, and the set of running entries already
 * propagates via React state (sidebar items rebuild when `running`
 * flips), so re-running the memo on items change is enough.
 */
export function useRunningTabs(): {
  tabs: RunningSessionItem[];
  numbers: Map<string, number>;
} {
  const { items } = useSidebar();
  return useMemo(() => {
    const tabs = orderRunningTabs(items, getSpawnedAt);
    const numbers = tabNumberMap(tabs);
    return { tabs, numbers };
  }, [items]);
}
