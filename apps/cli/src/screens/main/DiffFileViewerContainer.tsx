import { useCallback, useMemo } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { parseUnifiedDiff, renderDiffLines } from '@kirby/diff';
import {
  interleaveComments,
  getCommentPositions,
} from '@kirby/review-comments';
import { DiffViewer } from '../reviews/DiffViewer.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useAsyncOps } from '../../context/AsyncOpsContext.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import { useDiffData } from '../../hooks/useDiffData.js';
import { useReviewComments } from '../../hooks/useReviewComments.js';
import { useScrollWheel } from '../../hooks/useScrollWheel.js';
import { handleDiffViewerInput } from './main-input.js';

interface DiffFileViewerContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  selectedPr: PullRequestInfo | undefined;
  terminalFocused: boolean;
}

// Owns the single-file half of the old DiffPane: parses the diff for
// the currently opened file, interleaves review comments, computes the
// annotated line stream + comment positions, wires scroll-wheel input,
// and routes diff-viewer keypresses. Mounted by MainContent when
// paneMode === 'diff-file'.
export function DiffFileViewerContainer({
  pane,
  terminal,
  selectedPr,
  terminalFocused,
}: DiffFileViewerContainerProps) {
  const sessionCtx = useSessionActions();
  const configCtx = useConfig();
  const keybinds = useKeybindResolve();
  const asyncOps = useAsyncOps();

  const reviewComments = useReviewComments(selectedPr?.id ?? null);

  const diffData = useDiffData(
    selectedPr?.id ?? null,
    selectedPr?.sourceBranch ?? '',
    selectedPr?.targetBranch ?? ''
  );

  // ── Parsed diff for the current file ────────────────────────────
  const fileDiffData = useMemo(() => {
    if (!pane.diffViewFile || !diffData.diffText) return null;
    const allDiffs = parseUnifiedDiff(diffData.diffText);
    const fileDiffLines = allDiffs.get(pane.diffViewFile);
    if (!fileDiffLines) return null;
    const rendered = renderDiffLines(fileDiffLines, terminal.paneCols);
    return { fileDiffLines, rendered };
  }, [pane.diffViewFile, diffData.diffText, terminal.paneCols]);

  const fileComments = useMemo(
    () => reviewComments.filter((c) => c.file === pane.diffViewFile),
    [reviewComments, pane.diffViewFile]
  );

  const interleaveResult = useMemo(() => {
    if (!fileDiffData || fileComments.length === 0) return null;
    return interleaveComments(
      fileDiffData.fileDiffLines,
      fileDiffData.rendered,
      fileComments,
      terminal.paneCols,
      pane.selectedCommentId,
      pane.pendingDeleteCommentId,
      pane.editingCommentId,
      pane.editBuffer
    );
  }, [
    fileDiffData,
    fileComments,
    terminal.paneCols,
    pane.selectedCommentId,
    pane.pendingDeleteCommentId,
    pane.editingCommentId,
    pane.editBuffer,
  ]);

  const annotatedLines = useMemo(() => {
    if (interleaveResult) return interleaveResult.lines;
    if (!fileDiffData) return [];
    return fileDiffData.rendered.map((line) => ({
      type: 'diff' as const,
      rendered: line,
    }));
  }, [interleaveResult, fileDiffData]);

  const diffTotalLines = annotatedLines.length;

  const commentPositions = useMemo(() => {
    if (!interleaveResult || fileComments.length === 0) return new Map();
    return getCommentPositions(
      interleaveResult.lines,
      interleaveResult.insertionMap,
      fileComments
    );
  }, [interleaveResult, fileComments]);

  // ── Scroll wheel ────────────────────────────────────────────────
  const { setDiffScrollOffset } = pane;
  const handleScrollWheel = useCallback(
    (delta: number) => {
      const viewportHeight = Math.max(1, terminal.paneRows - 3);
      const maxScroll = Math.max(0, diffTotalLines - viewportHeight);
      setDiffScrollOffset((o) => Math.max(0, Math.min(o + delta, maxScroll)));
    },
    [terminal.paneRows, diffTotalLines, setDiffScrollOffset]
  );
  useScrollWheel(!terminalFocused, handleScrollWheel);

  // ── Input routing ───────────────────────────────────────────────
  useInput(
    (input, key) => {
      handleDiffViewerInput(input, key, {
        pane,
        diffFiles: diffData.files,
        terminal,
        diffTotalLines,
        commentCtx: selectedPr
          ? {
              comments: reviewComments,
              prId: selectedPr.id,
              positions: commentPositions,
              selectedReviewPr: selectedPr,
            }
          : undefined,
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
      scrollOffset={pane.diffScrollOffset}
      paneRows={terminal.paneRows}
      paneCols={terminal.paneCols}
      loading={diffData.diffLoading}
    />
  );
}
