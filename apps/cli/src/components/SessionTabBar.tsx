import { Box, Text } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import {
  useSessionData,
  runningTabsFromItems,
  getItemKey,
  getSpawnedAt,
  useSidebar,
  tabDigit,
  type RunningSessionItem,
} from '@kirby/app-core';
import { useMemo } from 'react';
import { theme } from '../theme.js';

const MAX_LABEL_CHARS = 16;

function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

function tabLabel(
  tabNumber: number,
  item: RunningSessionItem,
  pr: PullRequestInfo | undefined
): string {
  const digit = tabDigit(tabNumber);
  const body = pr
    ? `#${pr.id}`
    : middleTruncate(item.session.name, MAX_LABEL_CHARS);
  return `${digit} ${body}`;
}

export function SessionTabBar() {
  const { items, selectedIndex } = useSidebar();
  const { sessionPrMap } = useSessionData();
  // Same computation as app-core's useRunningTabs, but fed explicitly
  // so the component only depends on barrel exports (test-mockable).
  const { tabs, numbers } = useMemo(
    () => runningTabsFromItems(items, getSpawnedAt),
    [items]
  );

  // `numbers` is already capped at MAX_TABS by tabNumberMap(), so its
  // size is the cap — deriving from it keeps the two in sync instead of
  // repeating the literal here.
  const visibleTabs = tabs.slice(0, numbers.size);
  const overflow = tabs.length - visibleTabs.length;

  const selectedItem = items[selectedIndex];
  const selectedKey = selectedItem ? getItemKey(selectedItem) : null;

  // Always reserve the row (even empty) so PTY rows stay stable as
  // sessions come and go — flicker is worse than a blank line.
  if (visibleTabs.length === 0) {
    return <Box height={1} />;
  }

  return (
    <Box flexDirection="row" height={1} paddingX={1}>
      {visibleTabs.map((item) => {
        const itemKey = getItemKey(item);
        const isActive = itemKey === selectedKey;
        const pr = sessionPrMap.get(item.session.name);
        const tabNumber = numbers.get(item.session.name)!;
        return (
          <Box key={itemKey} marginRight={1}>
            <Text
              color={isActive ? theme.border.active : theme.border.inactive}
              inverse={isActive}
            >
              {tabLabel(tabNumber, item, pr)}
            </Text>
          </Box>
        );
      })}
      {overflow > 0 && <Text color={theme.border.inactive}>+{overflow}</Text>}
    </Box>
  );
}
