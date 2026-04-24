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

  // Interleave only needs structural state: thread positions don't
  // depend on edit/reply buffers anymore — those flow through to the
  // Ink card components as props. The memo re-runs on selection /
  // editing-id changes because those affect highlight semantics
  // (selected diff-line highlighting).
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
      null,
      null,
      undefined,
      fileRemoteThreads,
      null,
      undefined
    );
  }, [
    fileDiffData,
    fileComments,
    fileRemoteThreads,
    terminal.paneCols,
    pane.selectedCommentId,
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
  const sectionAnchors = interleaveResult?.sectionAnchors ?? [0];

  const commentPositions = useMemo(() => {
    if (!interleaveResult) return new Map();
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
        sectionAnchors,
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
      hasSections={sectionAnchors.length > 1}
      selectedCommentId={pane.selectedCommentId}
      pendingDeleteCommentId={pane.pendingDeleteCommentId}
      editingCommentId={pane.editingCommentId}
      editBuffer={pane.editBuffer}
      replyingToThreadId={pane.replyingToThreadId}
      replyBuffer={pane.replyBuffer}
    />
  );
}
