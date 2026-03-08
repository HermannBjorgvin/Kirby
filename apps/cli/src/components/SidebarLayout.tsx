import type { ReactNode } from 'react';
import { Text, Box } from 'ink';

interface SidebarLayoutProps {
  title: string;
  focused: boolean;
  sidebarWidth: number;
  emptyText?: string;
  isEmpty: boolean;
  keybinds: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
}

export function SidebarLayout({
  title,
  focused,
  sidebarWidth,
  emptyText = '(empty)',
  isEmpty,
  keybinds,
  legend,
  children,
}: SidebarLayoutProps) {
  const innerWidth = Math.max(10, sidebarWidth - 2);

  return (
    <Box flexDirection="column" width={sidebarWidth} paddingX={1}>
      <Text bold color={focused ? 'blue' : 'gray'}>
        {title}
      </Text>
      <Text dimColor>{'─'.repeat(innerWidth)}</Text>
      {isEmpty ? <Text dimColor>{emptyText}</Text> : children}
      <Box marginTop={1} flexDirection="column">
        {keybinds}
      </Box>
      {legend && (
        <Box marginTop={1} flexDirection="column">
          {legend}
        </Box>
      )}
    </Box>
  );
}
