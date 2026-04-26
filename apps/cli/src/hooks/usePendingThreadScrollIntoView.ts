import { useEffect } from 'react';
import type { CommentPositionInfo, RowMap } from '@kirby/review-comments';

export interface UsePendingThreadScrollIntoViewOptions {
  /** Thread id to scroll into view, or null when nothing is pending. */
  pendingThreadId: string | null;
  /** id → annotated-line position map from `getCommentPositions`. */
  commentPositions: Map<string, CommentPositionInfo>;
  /** Row map from `buildRowMap`. */
  rowMap: RowMap;
  /** Total scrollable rows. */
  diffTotalRows: number;
  /** Pane viewport height in rows. */
  paneRows: number;
  setDiffScrollOffset: (updater: number | ((prev: number) => number)) => void;
  setPendingScrollThreadId: (id: string | null) => void;
}

/**
 * After a reply posts the row map grows; if the new reply lands
 * below the current viewport the user can't see what they just
 * posted. The reply-mode success handler sets
 * `pane.pendingScrollThreadId`; we wait for `commentPositions` /
 * `rowMap` to reflect the post-reply layout, then scroll the
 * thread's bottom into view (one row of breathing room) and clear
 * the pending id.
 */
export function usePendingThreadScrollIntoView({
  pendingThreadId,
  commentPositions,
  rowMap,
  diffTotalRows,
  paneRows,
  setDiffScrollOffset,
  setPendingScrollThreadId,
}: UsePendingThreadScrollIntoViewOptions): void {
  useEffect(() => {
    if (!pendingThreadId) return;
    const info = commentPositions.get(pendingThreadId);
    if (!info) return;
    const rowEntry = rowMap.positions[info.headerLine];
    if (!rowEntry) return;
    const viewportHeight = Math.max(1, paneRows - 3);
    const maxScroll = Math.max(0, diffTotalRows - viewportHeight);
    const threadEndRow = rowEntry.rowStart + rowEntry.rowSpan - 1;
    const minScrollOffset = Math.max(0, threadEndRow - viewportHeight + 2);
    setDiffScrollOffset((cur) =>
      Math.min(Math.max(cur, minScrollOffset), maxScroll)
    );
    setPendingScrollThreadId(null);
  }, [
    pendingThreadId,
    commentPositions,
    rowMap,
    diffTotalRows,
    paneRows,
    setDiffScrollOffset,
    setPendingScrollThreadId,
  ]);
}
