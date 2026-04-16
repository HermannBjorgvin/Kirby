import type { ReactNode } from 'react';
import { Text, Box } from 'ink';
import { Pane } from './Pane.js';

interface SidebarLayoutProps {
  title?: string;
  focused: boolean;
  sidebarWidth: number;
  emptyText?: string;
  isEmpty: boolean;
  keybinds: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
}

// Layout wrapper for the sidebar column. Content is laid out top-to-bottom:
//   - optional title (rendered by Pane as the first row inside the border)
//   - scrollable items area (flex-grows to fill remaining space)
//   - keybinds footer
//   - optional legend
// The Pane component owns the round border and the focused/unfocused color.
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
  return (
    <Pane focused={focused} title={title} width={sidebarWidth} flexShrink={0}>
      <Box flexDirection="column" flexGrow={1}>
        {isEmpty ? <Text dimColor>{emptyText}</Text> : children}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {keybinds}
      </Box>
      {legend && (
        <Box marginTop={1} flexDirection="column">
          {legend}
        </Box>
      )}
    </Pane>
  );
}
