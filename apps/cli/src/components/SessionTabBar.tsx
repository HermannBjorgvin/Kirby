import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { useSidebar } from '../context/SidebarContext.js';
import { useSessionData } from '../context/SessionContext.js';
import { theme } from '../theme.js';
import { getItemKey } from '../types.js';
import type { SidebarItem } from '../types.js';

type RunningSessionItem = Extract<SidebarItem, { kind: 'session' }>;

const MAX_TABS = 10;
const MAX_LABEL_CHARS = 10;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function tabLabel(
  index: number,
  item: RunningSessionItem,
  pr: PullRequestInfo | undefined
): string {
  const digit = index === 9 ? '0' : String(index + 1);
  const body = pr ? `#${pr.id}` : truncate(item.session.name, MAX_LABEL_CHARS);
  return `${digit} ${body}`;
}

export function SessionTabBar() {
  const { items, selectedIndex } = useSidebar();
  const { sessionPrMap } = useSessionData();

  const runningSessions = useMemo<RunningSessionItem[]>(
    () =>
      items.filter(
        (it): it is RunningSessionItem =>
          it.kind === 'session' && it.session.running
      ),
    [items]
  );

  const visibleTabs = runningSessions.slice(0, MAX_TABS);
  const overflow = runningSessions.length - visibleTabs.length;

  const selectedItem = items[selectedIndex];
  const selectedKey = selectedItem ? getItemKey(selectedItem) : null;

  // Always reserve the row (even empty) so PTY rows stay stable as
  // sessions come and go — flicker is worse than a blank line.
  if (visibleTabs.length === 0) {
    return <Box height={1} />;
  }

  return (
    <Box flexDirection="row" height={1} paddingX={1}>
      {visibleTabs.map((item, i) => {
        const itemKey = getItemKey(item);
        const isActive = itemKey === selectedKey;
        const pr = sessionPrMap.get(item.session.name);
        return (
          <Box key={itemKey} marginRight={1}>
            <Text
              color={isActive ? theme.border.active : theme.border.inactive}
              inverse={isActive}
            >
              {tabLabel(i, item, pr)}
            </Text>
          </Box>
        );
      })}
      {overflow > 0 && <Text color={theme.border.inactive}>+{overflow}</Text>}
    </Box>
  );
}
