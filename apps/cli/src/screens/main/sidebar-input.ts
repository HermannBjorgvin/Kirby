import type { KeyPress } from '@kirby/core';
import type { SidebarInputCtx } from './input-types.js';
import {
  SIDEBAR_ACTIONS,
  switchTab,
  type SidebarAction,
} from './sidebar-actions.js';

/**
 * Active-session tab switching (digits 1..9, 0 = tab 10). The ten
 * action IDs differ only by the tab they select, so they join the same
 * table as everything else rather than being pattern-matched out of
 * the action ID at dispatch time.
 */
const TAB_ACTIONS: Record<string, SidebarAction> = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [
    `sidebar.switch-tab-${i + 1}`,
    (ctx: SidebarInputCtx) => switchTab(ctx, i + 1),
  ])
);

const ACTION_TABLE: Record<string, SidebarAction> = {
  ...SIDEBAR_ACTIONS,
  ...TAB_ACTIONS,
};

/**
 * Sidebar keyboard entry point: resolve the keypress to an action ID
 * and run that action. Every guard on the current selection lives
 * inside the action itself (see ./sidebar-actions.ts), so a keypress
 * the selection can't service resolves and then does nothing.
 */
export function handleSidebarInput(
  input: string,
  key: KeyPress,
  ctx: SidebarInputCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'sidebar');
  if (!action) return;
  ACTION_TABLE[action]?.(ctx);
}
