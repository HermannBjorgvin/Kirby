import { useEffect, useRef } from 'react';
import {
  anchorAdjust,
  clampOffset,
  itemBounds,
  revealBottom,
  scrollIntoView,
  totalRows,
  type ItemBounds,
} from '../utils/virtual-viewport.js';
import {
  itemKey,
  type DiffListLayout,
} from '../screens/reviews/diff-list-layout.js';

export interface UseDiffListScrollSyncOptions {
  /** Current unified-list geometry — recomputed per render, so an
   *  open compose input's growth is already reflected in the spans by
   *  the time these effects run. */
  layout: DiffListLayout;
  /** Selected unified-list ordinal (files first, then comments). */
  selectedIndex: number;
  /** Which compose input is open, if any. Reply inputs render at the
   *  BOTTOM of their card, the annotate composer's input at the TOP
   *  of its slot — the two need opposite scroll alignment. */
  composeMode: 'reply' | 'annotate' | null;
  /** Thread id queued for a post-reply reveal (set by onReplyPosted). */
  pendingScrollThreadId: string | null;
  setDiffListScrollRow: (updater: (prev: number) => number) => void;
  setPendingScrollThreadId: (id: string | null) => void;
}

/**
 * Keeps `diffListScrollRow` coherent when item sizes change out from
 * under it. The input handler can only react to the keypress render's
 * (stale) spans; these effects run after the layout memo has absorbed
 * the change, mirroring `usePendingThreadScrollIntoView` in the diff
 * viewer. All updates go through functional updaters and none depend
 * on the offset itself, so they can't loop.
 */
export function useDiffListScrollSync({
  layout,
  selectedIndex,
  composeMode,
  pendingScrollThreadId,
  setDiffListScrollRow,
  setPendingScrollThreadId,
}: UseDiffListScrollSyncOptions): void {
  // ── Compose visibility ──────────────────────────────────────────
  // While a reply/annotate input is open it swallows every keypress,
  // so the user can't scroll manually — keep the input on screen.
  // Reply inputs live at the card's BOTTOM (reveal the bottom edge);
  // the annotate composer's input lives at the TOP of its
  // card-footprint slot (top-align when taller than the viewport).
  // Re-runs per keystroke (the layout memo depends on the buffers),
  // so a buffer wrapping to a new line re-reveals the cursor.
  useEffect(() => {
    if (!composeMode) return;
    const bounds = itemBounds(layout.spans)[selectedIndex];
    if (!bounds) return;
    const total = totalRows(layout.spans);
    setDiffListScrollRow((o) =>
      composeMode === 'annotate'
        ? scrollIntoView(
            clampOffset(o, total, layout.viewportRows),
            bounds,
            layout.viewportRows
          )
        : clampOffset(
            revealBottom(o, bounds, layout.viewportRows),
            total,
            layout.viewportRows
          )
    );
  }, [composeMode, layout, selectedIndex, setDiffListScrollRow]);

  // ── Scroll anchoring ────────────────────────────────────────────
  // The offset is an absolute row; when spans change upstream (a
  // thread grows after a refetch, an estimate changes) the same row
  // means different content. Anchor on the selected item: shift the
  // offset by its top-row delta so the viewport stays glued to what
  // the user is looking at. Items are matched by identity (file path
  // / thread id), so insertions above don't confuse the anchor; if
  // the selected item is new to the list, fall back to scrolling it
  // into view.
  const prevRef = useRef<{ keys: string[]; bounds: ItemBounds[] } | null>(null);
  useEffect(() => {
    const keys = layout.items.map(itemKey);
    const bounds = itemBounds(layout.spans);
    const prev = prevRef.current;
    prevRef.current = { keys, bounds };
    if (!prev) return;
    const unchanged =
      prev.keys.length === keys.length &&
      prev.keys.every((k, i) => k === keys[i]) &&
      prev.bounds.every((b, i) => b.top === bounds[i]?.top);
    if (unchanged) return;

    const selBounds = bounds[selectedIndex];
    const selKey = keys[selectedIndex];
    if (!selBounds || !selKey) return;
    const total = totalRows(layout.spans);
    const prevIdx = prev.keys.indexOf(selKey);
    if (prevIdx >= 0) {
      const prevTop = prev.bounds[prevIdx]?.top ?? selBounds.top;
      setDiffListScrollRow((o) =>
        anchorAdjust({
          offset: o,
          prevTop,
          nextTop: selBounds.top,
          totalRows: total,
          viewportRows: layout.viewportRows,
        })
      );
    } else {
      setDiffListScrollRow((o) =>
        scrollIntoView(
          clampOffset(o, total, layout.viewportRows),
          selBounds,
          layout.viewportRows
        )
      );
    }
  }, [layout, selectedIndex, setDiffListScrollRow]);

  // ── Post-reply reveal ───────────────────────────────────────────
  // After a reply posts the thread grows by the new reply, which can
  // land below the fold. The reply-mode success handler queues the
  // thread id; reveal its bottom and clear. Same contract as the diff
  // viewer's usePendingThreadScrollIntoView.
  useEffect(() => {
    if (!pendingScrollThreadId) return;
    const idx = layout.items.findIndex(
      (it) => it.kind === 'comment' && it.thread.id === pendingScrollThreadId
    );
    const bounds = itemBounds(layout.spans)[idx];
    if (idx < 0 || !bounds) return;
    const total = totalRows(layout.spans);
    setDiffListScrollRow((o) =>
      clampOffset(
        revealBottom(o, bounds, layout.viewportRows),
        total,
        layout.viewportRows
      )
    );
    setPendingScrollThreadId(null);
  }, [
    pendingScrollThreadId,
    layout,
    setDiffListScrollRow,
    setPendingScrollThreadId,
  ]);
}
