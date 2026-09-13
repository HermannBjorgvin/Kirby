import { useCallback } from 'react';
import { getItemKey, getPrFromItem, type SidebarItem } from '@kirby/core';
import { sidebarHitTestRef } from '../../components/sidebar-hit-test.js';
import {
  useScrollWheel,
  useMouseClicks,
  type MouseClick,
} from '../../hooks/useScrollWheel.js';
import { openUrl } from '../../utils/open-url.js';

interface SidebarMouseDeps {
  /** Whether the sidebar should react to mouse events at all. */
  active: boolean;
  /** Rightmost column of the sidebar region (1-based, inclusive). */
  sidebarWidth: number;
  items: SidebarItem[];
  moveSelection: (offset: number) => void;
  selectByKey: (key: string) => void;
}

/**
 * Wheel + click support for the sidebar column. Wheel moves the
 * selection; a click selects the row under the pointer, and a click on
 * a PR-badge line also opens the PR in the browser — SGR mouse
 * tracking captures the click that would otherwise trigger the
 * terminal's own OSC-8 link handling.
 */
export function useSidebarMouse({
  active,
  sidebarWidth,
  items,
  moveSelection,
  selectByKey,
}: SidebarMouseDeps): void {
  const region = { xMax: sidebarWidth };

  const onWheel = useCallback(
    (ticks: number) => moveSelection(ticks),
    [moveSelection]
  );
  useScrollWheel(active, onWheel, region);

  const onClick = useCallback(
    (click: MouseClick) => {
      const hit = sidebarHitTestRef.current?.(click.y);
      if (!hit) return;
      const item = items[hit.itemIndex];
      if (!item) return;
      selectByKey(getItemKey(item));
      if (hit.badgeLine) {
        const pr = getPrFromItem(item);
        if (pr?.url) openUrl(pr.url);
      }
    },
    [items, selectByKey]
  );
  useMouseClicks(active, onClick, region);
}
