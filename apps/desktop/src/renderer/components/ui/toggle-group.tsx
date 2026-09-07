import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

/**
 * A set of choices with one roving tab stop: the arrows move focus
 * between items (without choosing), Home/End jump to the ends, and
 * Enter/Space choose the focused one. Radix draws `data-state="on"`
 * on the chosen item and, for `type="single"`, renders the items as
 * radios — the same thing a screen reader would call them.
 */
function ToggleGroup({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
