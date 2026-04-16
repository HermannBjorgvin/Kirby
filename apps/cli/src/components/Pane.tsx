import type { ComponentProps, ReactNode } from 'react';
import { TitledBox } from '@mishieck/ink-titled-box';
import { theme } from '../theme.js';

// Pane is a pure visual wrapper: a bordered box with an active/inactive
// color tied to the `focused` prop and an optional title rendered
// INSIDE the top border line (e.g. `╭── Title ──╮`). No hooks, no
// input handling, no context reads — just a styled container.
//
// The border + title rendering is delegated to @mishieck/ink-titled-box,
// which handles the title-in-border glyph composition for us. Previous
// iterations tried to do this by hand (custom top row with disabled
// borderTop + concatenated border chars) — an explicit library does
// it more reliably than our bespoke implementation.
//
// We rely on TitledBox's default title style (space padding on both
// ends, no decorative wrapper chars) so the title reads as plain text
// sitting in the border line — keeps the visual quiet.

type TitledBoxProps = ComponentProps<typeof TitledBox>;

interface PaneProps
  extends Omit<
    TitledBoxProps,
    'borderStyle' | 'borderColor' | 'titles' | 'titleStyles' | 'children'
  > {
  focused: boolean;
  title?: string;
  children: ReactNode;
}

export function Pane({ focused, title, children, ...boxProps }: PaneProps) {
  const color = focused ? theme.border.active : theme.border.inactive;

  return (
    <TitledBox
      borderStyle={theme.border.style}
      borderColor={color}
      titles={title ? [title] : []}
      flexDirection="column"
      {...boxProps}
    >
      {children}
    </TitledBox>
  );
}
