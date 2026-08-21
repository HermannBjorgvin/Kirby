import { useCallback } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { DiffViewer } from '../reviews/DiffViewer.js';
import { CARD_INDENT, CARD_MAX_WIDTH } from '../../components/CommentThread.js';
import type {
  TerminalLayout,
  PaneModeValue,
  DiffBundle,
} from '@kirby/app-core';
import {
  useSessionActions,
  useConfig,
  useKeybindResolve,
  useAsyncOps,
  usePlan,
  useDiffFileViewerViewModel,
} from '@kirby/app-core';
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
  const plan = usePlan();

  // Shell-agnostic derivations + scroll effects live in the app-core
  // controller; this wrapper only adds TUI card geometry, the Ink
  // scroll wheel, and Ink input routing.
  //
  // Card width math, mirrored in DiffViewer. The row map needs the
  // card content width to estimate body wrap accurately.
  const cardWidth = Math.max(
    20,
    Math.min(CARD_MAX_WIDTH, terminal.paneCols - CARD_INDENT - 2)
  );
  const cardContentWidth = Math.max(1, cardWidth - 4);

  const vm = useDiffFileViewerViewModel({
    pane,
    paneRows: terminal.paneRows,
    cardContentWidth,
    selectedPr,
    diffBundle,
  });
  const {
    inPlanKeys,
    annotatedLines,
    rowMap,
    commentPositions,
    fileDiffLoading,
    fileRemoteThreads,
    diffTotalRows,
    sectionAnchorRows,
  } = vm;

  // ── Scroll wheel ────────────────────────────────────────────────
  const { setDiffScrollOffset } = pane;
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
        plan,
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
      inPlanKeys={inPlanKeys}
      annotatingPlanKey={pane.annotatingPlanKey}
      annotationBuffer={pane.annotationBuffer}
    />
  );
}
