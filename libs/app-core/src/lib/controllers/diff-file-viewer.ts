import { useEffect, useMemo } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { parseUnifiedDiff } from '@kirby/diff';
import {
  interleaveComments,
  getCommentPositions,
  buildRowMap,
} from '@kirby/review-comments';
import { planItemKey } from '@kirby/core';
import { usePlan } from '../context/PlanContext.js';
import { useAutoSelectFirstComment } from '../hooks/useAutoSelectFirstComment.js';
import { usePendingThreadScrollIntoView } from '../hooks/usePendingThreadScrollIntoView.js';
import type { PaneModeValue } from '../hooks/usePaneReducer.js';
import type { DiffBundle } from '../hooks/useDiffBundle.js';

/**
 * Shell-agnostic view model for the single-file diff viewer: parses
 * the diff for the currently opened file, interleaves review comments,
 * computes the annotated line stream + comment positions + row map,
 * and runs the auto-select / pending-thread-scroll effects.
 *
 * The shell provides `cardContentWidth` (its own card geometry) and
 * the terminal/window pane size; keypress routing and scroll-wheel
 * input stay in the shell-specific containers.
 */
export function useDiffFileViewerViewModel({
  pane,
  paneRows,
  cardContentWidth,
  selectedPr,
  diffBundle,
}: {
  pane: PaneModeValue;
  /** Visible content rows of the pane (drives scroll/auto-select math). */
  paneRows: number;
  /** Width available for comment card bodies (shell-specific geometry). */
  cardContentWidth: number;
  selectedPr: PullRequestInfo | undefined;
  diffBundle: DiffBundle;
}) {
  const plan = usePlan();
  // The snapshot IS the plan: getSnapshot returns the whole
  // PR-keyed map and list() is a lookup in it. Reading it directly
  // means the memo below derives from the value it depends on, rather
  // than calling into module state with the snapshot as a separate
  // change signal that nothing in the body reads.
  const planSnapshot = plan.snapshot;

  // Set of `${kind}:${id}` keys for comments already in this PR's plan.
  // Recomputed on any plan change (plan.snapshot identity) and threaded
  // to the cards as booleans so their memoization stays stable.
  const prId = selectedPr?.id;
  const inPlanKeys = useMemo(() => {
    const m = new Map<string, boolean>();
    if (prId != null) {
      for (const i of planSnapshot.get(prId) ?? []) {
        m.set(planItemKey(i.kind, i.id), !!i.annotation);
      }
    }
    return m;
  }, [prId, planSnapshot]);

  // Trigger a per-file diff fetch on file open. Cached internally
  // by useDiffData, so navigating back and forth is free.
  const { loadFileDiff } = diffBundle;
  useEffect(() => {
    if (pane.diffViewFile) {
      void loadFileDiff(pane.diffViewFile);
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
  // depend on edit/reply buffers — those flow through to the card
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

  // The row map needs the card content width to estimate body wrap
  // accurately.
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

  useAutoSelectFirstComment({
    file: pane.diffViewFile,
    fileComments,
    fileRemoteThreads,
    commentPositions,
    rowMap,
    diffTotalRows,
    paneRows,
    setSelectedCommentId: pane.setSelectedCommentId,
    setDiffScrollOffset: pane.setDiffScrollOffset,
  });

  usePendingThreadScrollIntoView({
    pendingThreadId: pane.pendingScrollThreadId,
    commentPositions,
    rowMap,
    diffTotalRows,
    paneRows,
    setDiffScrollOffset: pane.setDiffScrollOffset,
    setPendingScrollThreadId: pane.setPendingScrollThreadId,
  });

  return {
    inPlanKeys,
    annotatedLines,
    rowMap,
    commentPositions,
    fileDiffLoading,
    fileComments,
    fileRemoteThreads,
    diffTotalRows,
    sectionAnchorRows,
  };
}

export type DiffFileViewerViewModel = ReturnType<
  typeof useDiffFileViewerViewModel
>;
