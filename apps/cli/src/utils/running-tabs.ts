import type { SidebarItem } from '../types.js';

export type RunningSessionItem = Extract<SidebarItem, { kind: 'session' }>;

const MAX_TABS = 10;

/**
 * Return all running session rows from the sidebar items list, sorted
 * ascending by PTY spawn time. Sessions whose PTY entry isn't found
 * (race window between `running` flipping and the registry read) sort
 * to the end via Infinity — they'd land at the end anyway.
 *
 * Pure: no React state, no module side-effects. The `spawnedAt` lookup
 * is passed in (typically `getSpawnedAt` from `pty-registry`).
 */
export function orderRunningTabs(
  items: SidebarItem[],
  spawnedAt: (name: string) => number | undefined
): RunningSessionItem[] {
  return items
    .filter(
      (it): it is RunningSessionItem =>
        it.kind === 'session' && it.session.running
    )
    .sort((a, b) => {
      const tA = spawnedAt(a.session.name) ?? Number.POSITIVE_INFINITY;
      const tB = spawnedAt(b.session.name) ?? Number.POSITIVE_INFINITY;
      return tA - tB;
    });
}

/**
 * Map session name → 1-indexed tab number, capped at the first 10
 * tabs (digits 1..9 then 0 = tab 10). Sessions outside the cap are
 * absent from the map. Consumed by both the tab bar (for highlight)
 * and the sidebar (for the digit prefix on each row).
 */
export function tabNumberMap(
  orderedTabs: RunningSessionItem[]
): Map<string, number> {
  const map = new Map<string, number>();
  orderedTabs.slice(0, MAX_TABS).forEach((item, i) => {
    map.set(item.session.name, i + 1);
  });
  return map;
}

/**
 * Convert a 1..10 tab number to the digit shown in the UI: tab 10 is
 * displayed as "0" so it can be reached with the 0 key (no two-digit
 * keys allowed in single-keystroke quick-switch).
 */
export function tabDigit(tabNumber: number): string {
  return tabNumber === MAX_TABS ? '0' : String(tabNumber);
}
