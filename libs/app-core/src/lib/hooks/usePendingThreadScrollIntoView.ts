import { useEffect } from 'react';
import type { CommentPositionInfo, RowMap } from '@kirby/review-comments';
import { revealThreadEndOffset } from '@kirby/core';

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
 * Reveals a thread's bottom edge after a reply posts, so the user can
 * see what they just wrote.
 *
 * ## Why this is an effect and not a call at the intent origin
 *
 * The intent originates in `handleReplyModeInput`'s success callback
 * (`apps/cli/src/utils/reply-mode.ts`), which only sets the pending
 * id. It cannot do the scroll math itself, because the numbers the
 * math needs do not exist yet at that moment:
 *
 *   - The reply is appended to the thread by `useRemoteComments`'
 *     optimistic `setComments` (`libs/app-core/src/lib/hooks/
 *     useRemoteComments.ts`), which is a React state update queued
 *     during the same task — no render has flushed when the caller's
 *     `.then()` runs.
 *   - `rowStart` / `rowSpan` come from `buildRowMap`, which runs in a
 *     render memo downstream of that state. The row map the input
 *     handler closes over is the pre-reply one, and the thread's
 *     `rowSpan` is exactly what the new reply changes — using it
 *     would under-scroll by the height of the reply the user is
 *     trying to see. That is the bug this hook exists to avoid.
 *
 * So the round trip is load-bearing: the pending id means "reveal
 * this thread once the layout reflects it". The guards below are the
 * wait — `commentPositions` and `rowMap` are rebuilt asynchronously
 * (the diff text itself loads async too), so early passes legitimately
 * have no entry for the thread and must fall through untouched rather
 * than clear the signal. The id is cleared only on the pass that
 * actually scrolls, which is also what makes this fire once.
 *
 * The scroll math is `revealThreadEndOffset` (pure, unit-tested in
 * `libs/core/src/lib/utils/diff-scroll.spec.ts`); this hook owns
 * only the timing.
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
    // Not in the row map yet — the post-reply layout hasn't landed.
    // Leave the signal set and wait for the render that has it.
    const rowEntry = rowMap.positions[info.headerLine];
    if (!rowEntry) return;
    setDiffScrollOffset((current) =>
      revealThreadEndOffset({
        current,
        rowStart: rowEntry.rowStart,
        rowSpan: rowEntry.rowSpan,
        totalRows: diffTotalRows,
        paneRows,
      })
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
