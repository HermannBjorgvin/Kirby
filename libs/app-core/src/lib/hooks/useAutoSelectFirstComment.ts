import { useEffect, useRef } from 'react';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import type {
  CommentPositionInfo,
  ReviewComment,
  RowMap,
} from '@kirby/review-comments';

export interface UseAutoSelectFirstCommentOptions {
  /** The currently opened diff file. The hook arms once per file change. */
  file: string | null | undefined;
  /** Local draft/posting comments for `file`. Posted ones are filtered out. */
  fileComments: ReviewComment[];
  /** Remote review threads anchored to `file`. */
  fileRemoteThreads: RemoteCommentThread[];
  /** id → annotated-line position map from `getCommentPositions`. */
  commentPositions: Map<string, CommentPositionInfo>;
  /** Row map from `buildRowMap` — used to translate the line index to a physical row. */
  rowMap: RowMap;
  /** Total scrollable rows (from `rowMap.totalRows`). */
  diffTotalRows: number;
  /** Pane viewport height in rows. */
  paneRows: number;
  setSelectedCommentId: (id: string | null) => void;
  setDiffScrollOffset: (updater: number | ((prev: number) => number)) => void;
}

/**
 * Auto-select + scroll-into-view the first comment when a file with
 * remote threads / local drafts is opened. Without this the user has
 * to press Shift+↓ once just to land on a comment that's typically
 * far down the file — and because the scroll jump on the first press
 * can move multiple cards out of view, it looks like "select →
 * deselect" rather than "moved to thread N+1".
 *
 * Tracked per-file: the auto-select fires once per file change. If
 * the user clears selection with Esc inside the same file, we do NOT
 * re-select — they explicitly opted out.
 */
export function useAutoSelectFirstComment({
  file,
  fileComments,
  fileRemoteThreads,
  commentPositions,
  rowMap,
  diffTotalRows,
  paneRows,
  setSelectedCommentId,
  setDiffScrollOffset,
}: UseAutoSelectFirstCommentOptions): void {
  const autoSelectedFileRef = useRef<string | null>(null);

  useEffect(() => {
    if (!file) return;
    // Already auto-selected for this file — don't re-fire (e.g. when
    // the user cleared selection with Esc, we honor that).
    if (autoSelectedFileRef.current === file) return;
    // Build the same nav pool diff-viewer-input uses (sorted by line)
    // so the "first comment" matches what Shift+↓ would walk to.
    // Posted local comments are rendered via the remote-thread path
    // (interleaveComments filters them out at libs/review-comments
    // /comment-renderer.ts:249), so their ids never appear in
    // `commentPositions`. Including them here would put a dead id at
    // navPool[0] for any thread that was authored from kirby, and the
    // rowEntry guard would silently bail forever — exactly the bug
    // we're fixing.
    const navPool: { id: string; lineStart: number }[] = [
      ...fileComments
        .filter((c) => c.status !== 'posted')
        .map((c) => ({
          id: c.id,
          lineStart: c.lineStart ?? Number.POSITIVE_INFINITY,
        })),
      ...fileRemoteThreads.map((t) => ({
        id: t.id,
        lineStart: t.lineStart ?? Number.POSITIVE_INFINITY,
      })),
    ].sort((a, b) => a.lineStart - b.lineStart);
    // Wait for at least one comment / thread to load before arming the
    // ref. Remote threads arrive async on file open so the first paint
    // may have an empty pool — skipping that pass means we still
    // auto-select once the data lands.
    if (navPool.length === 0) return;
    const first = navPool[0]!;
    // Scroll target mirrors `scrollToComment` in diff-viewer-input —
    // translate the refStartLine slot index to a physical row via the
    // row map and pin two rows above for a bit of code context.
    // commentPositions/rowMap depend on the parsed diff text, which
    // loads async via `loadFileDiff`. If comments arrived first the
    // first effect pass has nothing to scroll to — bail and let the
    // diff-text render fire us again. Without this gate we'd arm the
    // ref now, the next pass would be blocked, and the user would see
    // a selection that never scrolled into view.
    const info = commentPositions.get(first.id);
    const rowEntry = info ? rowMap.positions[info.refStartLine] : undefined;
    if (!rowEntry) return;

    autoSelectedFileRef.current = file;
    setSelectedCommentId(first.id);
    const viewportHeight = Math.max(1, paneRows - 3);
    const maxScroll = Math.max(0, diffTotalRows - viewportHeight);
    setDiffScrollOffset(
      Math.min(Math.max(0, rowEntry.rowStart - 2), maxScroll)
    );
  }, [
    file,
    fileComments,
    fileRemoteThreads,
    commentPositions,
    rowMap,
    diffTotalRows,
    paneRows,
    setSelectedCommentId,
    setDiffScrollOffset,
  ]);
}
