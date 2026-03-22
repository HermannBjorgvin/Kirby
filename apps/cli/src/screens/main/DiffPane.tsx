import { useMemo, useCallback } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { DiffViewer } from '../reviews/DiffViewer.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import { useDiffData } from '../../hooks/useDiffData.js';
import { useReviewComments } from '../../hooks/useReviewComments.js';
import { useScrollWheel } from '../../hooks/useScrollWheel.js';
import { partitionFiles, parseUnifiedDiff, renderDiffLines } from '@kirby/diff';
import {
  interleaveComments,
  getCommentPositions,
} from '@kirby/review-comments';
import {
  handleDiffFileListInput,
  handleDiffViewerInput,
} from './main-input.js';

interface DiffPaneProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  selectedPr: PullRequestInfo | undefined;
  terminalFocused: boolean;
}

export function DiffPane({
  pane,
  terminal,
  selectedPr,
  terminalFocused,
}: DiffPaneProps) {
  const sessionCtx = useSessionActions();
  const configCtx = useConfig();

  // ── Review comments (file-watched) ────────────────────────────
  const reviewComments = useReviewComments(selectedPr?.id ?? null);

  // ── Diff data ─────────────────────────────────────────────────
  const diffPrNumber = selectedPr?.id ?? null;
  const diffData = useDiffData(
    pane.paneMode === 'diff' || pane.paneMode === 'diff-file'
      ? diffPrNumber
      : null,
    selectedPr?.sourceBranch ?? '',
    selectedPr?.targetBranch ?? ''
  );

  const { normal: diffNormalFiles, skipped: diffSkippedFiles } = useMemo(
    () => partitionFiles(diffData.files),
    [diffData.files]
  );
  const diffDisplayCount = pane.showSkipped
    ? diffNormalFiles.length + diffSkippedFiles.length
    : diffNormalFiles.length;

  // Parsed diff data for current file
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

  // ── Scroll wheel ──────────────────────────────────────────────
  const scrollWheelActive = pane.paneMode === 'diff-file' && !terminalFocused;

  const { setDiffScrollOffset } = pane;
  const handleScrollWheel = useCallback(
    (delta: number) => {
      const viewportHeight = Math.max(1, terminal.paneRows - 3);
      const maxScroll = Math.max(0, diffTotalLines - viewportHeight);
      setDiffScrollOffset((o) => Math.max(0, Math.min(o + delta, maxScroll)));
    },
    [terminal.paneRows, diffTotalLines, setDiffScrollOffset]
  );

  useScrollWheel(scrollWheelActive, handleScrollWheel);

  // ── Input handling ─────────────────────────────────────────────
  const isDiffActive =
    !terminalFocused &&
    (pane.paneMode === 'diff' || pane.paneMode === 'diff-file');

  useInput(
    (input, key) => {
      if (pane.paneMode === 'diff') {
        return handleDiffFileListInput(input, key, {
          pane,
          diffFiles: diffData.files,
          diffDisplayCount,
          loadDiffText: diffData.loadDiffText,
        });
      }

      if (pane.paneMode === 'diff-file') {
        return handleDiffViewerInput(input, key, {
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
        });
      }
    },
    { isActive: isDiffActive }
  );

  // ── Render ─────────────────────────────────────────────────────
  if (pane.paneMode === 'diff') {
    return (
      <DiffFileList
        files={diffData.files}
        selectedIndex={pane.diffFileIndex}
        paneRows={terminal.paneRows}
        paneCols={terminal.paneCols}
        loading={diffData.loading}
        error={diffData.error}
        showSkipped={pane.showSkipped}
        comments={reviewComments}
      />
    );
  }

  if (pane.paneMode === 'diff-file' && pane.diffViewFile) {
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

  return null;
}
