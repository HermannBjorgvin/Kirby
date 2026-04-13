import type { ComponentProps, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

// Pane is a pure visual wrapper: a single Ink <Box> with a round border,
// an active/inactive color tied to the `focused` prop, and an optional
// bold title rendered as the first row *inside* the border. It has no
// hooks, no input handling, no context reads — it just takes props.
//
// Title placement note: Ink has no native API for rendering text inside
// a border line (e.g. ╭── Title ──╮). Earlier plan iterations considered
// disabling borderTop and drawing a custom row, but that's a hack around
// Ink's supported surface. We use the idiomatic approach: title is a
// normal first-row child inside the bordered box. Costs 1 row.

type BoxProps = ComponentProps<typeof Box>;

interface PaneProps extends Omit<BoxProps, 'borderStyle' | 'borderColor'> {
  focused: boolean;
  title?: string;
  children: ReactNode;
}

export function Pane({ focused, title, children, ...boxProps }: PaneProps) {
  const color = focused ? theme.border.active : theme.border.inactive;

  return (
    <Box
      borderStyle={theme.border.style}
      borderColor={color}
      flexDirection="column"
      {...boxProps}
    >
      {title && (
        <Box flexShrink={0}>
          <Text bold color={color}>
            {title}
          </Text>
        </Box>
      )}
      {children}
    </Box>
  );
}
