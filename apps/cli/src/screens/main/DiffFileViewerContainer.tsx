import { useCallback, useEffect, useMemo } from 'react';
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

  // Parse + render just this file's diff. Payload is kilobytes, not
  // megabytes, so the parse cost is negligible and re-runs on terminal
  // resize are imperceptible.
  const fileDiffData = useMemo(() => {
    if (!pane.diffViewFile || !fileDiffText) return null;
    const parsed = parseUnifiedDiff(fileDiffText);
    const fileDiffLines = parsed.get(pane.diffViewFile);
    if (!fileDiffLines) return null;
    const rendered = renderDiffLines(fileDiffLines, terminal.paneCols);
    return { fileDiffLines, rendered };
  }, [pane.diffViewFile, fileDiffText, terminal.paneCols]);

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

  const interleaveResult = useMemo(() => {
    if (
      !fileDiffData ||
      (fileComments.length === 0 && fileRemoteThreads.length === 0)
    )
      return null;
    return interleaveComments(
      fileDiffData.fileDiffLines,
      fileDiffData.rendered,
      fileComments,
      terminal.paneCols,
      pane.selectedCommentId,
      pane.pendingDeleteCommentId,
      pane.editingCommentId,
      pane.editBuffer,
      fileRemoteThreads,
      pane.replyingToThreadId,
      pane.replyBuffer
    );
  }, [
    fileDiffData,
    fileComments,
    fileRemoteThreads,
    terminal.paneCols,
    pane.selectedCommentId,
    pane.pendingDeleteCommentId,
    pane.editingCommentId,
    pane.editBuffer,
    pane.replyingToThreadId,
    pane.replyBuffer,
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
        diffFiles: diffBundle.files,
        terminal,
        diffTotalLines,
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
      scrollOffset={pane.diffScrollOffset}
      paneRows={terminal.paneRows}
      paneCols={terminal.paneCols}
      loading={fileDiffLoading}
    />
  );
}
