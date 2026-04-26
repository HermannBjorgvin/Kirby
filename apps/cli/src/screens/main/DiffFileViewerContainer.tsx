import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { parseUnifiedDiff } from '@kirby/diff';
import {
  interleaveComments,
  getCommentPositions,
  buildRowMap,
} from '@kirby/review-comments';
import { DiffViewer } from '../reviews/DiffViewer.js';
import { CARD_INDENT, CARD_MAX_WIDTH } from '../../components/CommentThread.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useAsyncOps } from '../../context/AsyncOpsContext.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { DiffBundle } from '../../hooks/useDiffBundle.js';
import { useScrollWheel } from '../../hooks/useScrollWheel.js';
import { handleDiffViewerInput } from './main-input.js';

interface DiffFileViewerContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  selectedPr: PullRequestInfo | undefined;
  terminalFocused: boolean;
  diffBundle: DiffBundle;
}

// Owns the single-file half of the old DiffPane: parses the diff for
// the currently opened file, interleaves review comments, computes the
// annotated line stream + comment positions, wires scroll-wheel input,
// and routes diff-viewer keypresses. Mounted by MainContent when
// paneMode === 'diff-file'. Diff data flows in via `diffBundle` from
// MainContent so the viewer shares state with the list container.
//
// Since M2: threads ride in `annotatedLines` as `{type:'thread-*'}`
// entries carrying the object, not pre-rendered ANSI. The Ink
// <DiffViewer> branches on type and renders real components for
// threads — so live edit/reply buffers flow through props and only
// re-render the one card whose props changed, no spliceCommentBlock
// overlay needed.
export function DiffFileViewerContainer({
  pane,
  terminal,
  selectedPr,
  terminalFocused,
  diffBundle,
}: DiffFileViewerContainerProps) {
  const sessionCtx = useSessionActions();
  const configCtx = useConfig();
  const keybinds = useKeybindResolve();
  const asyncOps = useAsyncOps();

  // Trigger a per-file diff fetch on file open. Cached internally
  // by useDiffData, so navigating back and forth is free.
  const { loadFileDiff } = diffBundle;
  useEffect(() => {
    if (pane.diffViewFile) {
      loadFileDiff(pane.diffViewFile);
    }
  }, [pane.diffViewFile, loadFileDiff]);

  const fileDiffText = pane.diffViewFile
    ? diffBundle.fileDiffs.get(pane.diffViewFile) ?? null
    : null;

  const fileDiffData = useMemo(() => {
    if (!pane.diffViewFile || !fileDiffText) return null;
    const parsed = parseUnifiedDiff(fileDiffText);
    const fileDiffLines = parsed.get(pane.diffViewFile);
    if (!fileDiffLines) return null;
    return { fileDiffLines };
  }, [pane.diffViewFile, fileDiffText]);

  const fileDiffLoading =
    diffBundle.fileDiffLoading === pane.diffViewFile && !fileDiffData;

  const fileComments = useMemo(
    () => diffBundle.comments.filter((c) => c.file === pane.diffViewFile),
    [diffBundle.comments, pane.diffViewFile]
  );

  const fileRemoteThreads = useMemo(
    () => diffBundle.remote.threads.filter((t) => t.file === pane.diffViewFile),
    [diffBundle.remote.threads, pane.diffViewFile]
  );

  // Interleave only needs structural state: thread positions don't
  // depend on edit/reply buffers — those flow through to the Ink card
  // components as props. The memo re-runs on selection / editing-id
  // changes because selection drives the highlight boolean on each
  // referenced diff row.
  const interleaveResult = useMemo(() => {
    if (!fileDiffData) return null;
    return interleaveComments(
      fileDiffData.fileDiffLines,
      fileComments,
      pane.selectedCommentId,
      fileRemoteThreads
    );
  }, [fileDiffData, fileComments, fileRemoteThreads, pane.selectedCommentId]);

  const annotatedLines = useMemo(
    () => interleaveResult?.lines ?? [],
    [interleaveResult]
  );

  // Card width math, mirrored in DiffViewer. The row map needs the
  // card content width to estimate body wrap accurately.
  const cardWidth = Math.max(
    20,
    Math.min(CARD_MAX_WIDTH, terminal.paneCols - CARD_INDENT - 2)
  );
  const cardContentWidth = Math.max(1, cardWidth - 4);

  const rowMap = useMemo(
    () =>
      buildRowMap({
        annotatedLines,
        sectionAnchors: interleaveResult?.sectionAnchors ?? [0],
        contentWidth: cardContentWidth,
        replyingToThreadId: pane.replyingToThreadId,
        editingCommentId: pane.editingCommentId,
        selectedCommentId: pane.selectedCommentId,
      }),
    [
      annotatedLines,
      interleaveResult?.sectionAnchors,
      cardContentWidth,
      pane.replyingToThreadId,
      pane.editingCommentId,
      pane.selectedCommentId,
    ]
  );

  const diffTotalRows = rowMap.totalRows;
  const sectionAnchorRows = rowMap.sectionAnchorRows;

  const commentPositions = useMemo(() => {
    if (!interleaveResult) return new Map();
    return getCommentPositions(
      interleaveResult.lines,
      interleaveResult.insertionMap,
      fileComments
    );
  }, [interleaveResult, fileComments]);

  // Auto-select + scroll-into-view the first comment when a file with
  // remote threads / local drafts is opened. Without this the user has
  // to press Shift+↓ once just to land on a comment that's typically
  // far down the file — and because the scroll jump on the first press
  // can move multiple cards out of view, it looks like "select →
  // deselect" rather than "moved to thread N+1".
  //
  // Tracked per-file: the auto-select fires once per file change. If
  // the user clears selection with Esc inside the same file, we do NOT
  // re-select — they explicitly opted out.
  const autoSelectedFileRef = useRef<string | null>(null);
  const { setSelectedCommentId, setDiffScrollOffset } = pane;
  useEffect(() => {
    const file = pane.diffViewFile;
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
    const viewportHeight = Math.max(1, terminal.paneRows - 3);
    const maxScroll = Math.max(0, diffTotalRows - viewportHeight);
    setDiffScrollOffset(
      Math.min(Math.max(0, rowEntry.rowStart - 2), maxScroll)
    );
  }, [
    pane.diffViewFile,
    fileComments,
    fileRemoteThreads,
    commentPositions,
    rowMap,
    diffTotalRows,
    terminal.paneRows,
    setSelectedCommentId,
    setDiffScrollOffset,
  ]);

  // After a reply posts the row map grows; if the new reply lands
  // below the current viewport the user can't see what they just
  // posted. The reply-mode success handler sets
  // `pane.pendingScrollThreadId`; we wait for `commentPositions` /
  // `rowMap` to reflect the post-reply layout, then scroll the
  // thread's bottom into view (one row of breathing room) and clear
  // the pending id.
  const { setPendingScrollThreadId } = pane;
  useEffect(() => {
    const tid = pane.pendingScrollThreadId;
    if (!tid) return;
    const info = commentPositions.get(tid);
    if (!info) return;
    const rowEntry = rowMap.positions[info.headerLine];
    if (!rowEntry) return;
    const viewportHeight = Math.max(1, terminal.paneRows - 3);
    const maxScroll = Math.max(0, diffTotalRows - viewportHeight);
    const threadEndRow = rowEntry.rowStart + rowEntry.rowSpan - 1;
    const minScrollOffset = Math.max(0, threadEndRow - viewportHeight + 2);
    setDiffScrollOffset((cur) =>
      Math.min(Math.max(cur, minScrollOffset), maxScroll)
    );
    setPendingScrollThreadId(null);
  }, [
    pane.pendingScrollThreadId,
    commentPositions,
    rowMap,
    diffTotalRows,
    terminal.paneRows,
    setDiffScrollOffset,
    setPendingScrollThreadId,
  ]);

  // ── Scroll wheel ────────────────────────────────────────────────
  const handleScrollWheel = useCallback(
    (delta: number) => {
      const viewportHeight = Math.max(1, terminal.paneRows - 3);
      const maxScroll = Math.max(0, diffTotalRows - viewportHeight);
      setDiffScrollOffset((o) => Math.max(0, Math.min(o + delta, maxScroll)));
    },
    [terminal.paneRows, diffTotalRows, setDiffScrollOffset]
  );
  useScrollWheel(!terminalFocused, handleScrollWheel);

  // ── Input routing ───────────────────────────────────────────────
  useInput(
    (input, key) => {
      handleDiffViewerInput(input, key, {
        pane,
        diffFiles: diffBundle.files,
        terminal,
        diffTotalRows,
        rowMap,
        sectionAnchorRows,
        commentCtx: selectedPr
          ? {
              comments: diffBundle.comments,
              prId: selectedPr.id,
              positions: commentPositions,
              selectedReviewPr: selectedPr,
            }
          : undefined,
        remoteCtx: {
          threads: fileRemoteThreads,
          replyToThread: diffBundle.remote.replyToThread,
          toggleResolved: diffBundle.remote.toggleResolved,
          refresh: diffBundle.remote.refresh,
        },
        config: configCtx,
        sessions: sessionCtx,
        asyncOps,
        keybinds,
      });
    },
    { isActive: !terminalFocused }
  );

  if (!pane.diffViewFile) return null;

  return (
    <DiffViewer
      filename={pane.diffViewFile}
      annotatedLines={annotatedLines}
      rowMap={rowMap}
      scrollOffset={pane.diffScrollOffset}
      paneRows={terminal.paneRows}
      paneCols={terminal.paneCols}
      loading={fileDiffLoading}
      hasSections={sectionAnchorRows.length > 1}
      selectedCommentId={pane.selectedCommentId}
      pendingDeleteCommentId={pane.pendingDeleteCommentId}
      editingCommentId={pane.editingCommentId}
      editBuffer={pane.editBuffer}
      replyingToThreadId={pane.replyingToThreadId}
      replyBuffer={pane.replyBuffer}
    />
  );
}
