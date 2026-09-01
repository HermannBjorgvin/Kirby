import { useMemo } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { computeDiffListLayout } from '../reviews/diff-list-layout.js';
import { useDiffListScrollSync } from '../../hooks/useDiffListScrollSync.js';
import type {
  TerminalLayout,
  PaneModeValue,
  DiffBundle,
} from '@kirby/app-core';
import {
  useKeybindResolve,
  useSessionActions,
  usePlan,
  useDiffFileListViewModel,
} from '@kirby/app-core';
import { handleDiffFileListInput } from './main-input.js';

interface DiffFileListContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  selectedPr: PullRequestInfo | undefined;
  terminalFocused: boolean;
  diffBundle: DiffBundle;
}

// Owns the file-list half of the old DiffPane: presents the file list
// for the selected PR, shows inline review comment badges, and routes
// diff-list keypresses. Data comes from the lifted diffBundle mounted
// in MainContent, so the list shares state with the viewer.
export function DiffFileListContainer({
  pane,
  terminal,
  selectedPr,
  terminalFocused,
  diffBundle,
}: DiffFileListContainerProps) {
  const keybinds = useKeybindResolve();
  const sessions = useSessionActions();
  const plan = usePlan();

  // Shell-agnostic derivations live in the app-core controller; this
  // wrapper only adds TUI layout geometry and Ink input wiring.
  const vm = useDiffFileListViewModel({ pane, selectedPr, diffBundle });
  const {
    treeMode,
    inPlanKeys,
    prId,
    orderedFiles,
    skippedFiles: diffSkippedFiles,
    fileCount,
    generalThreads,
    diffDisplayCount,
    displayFiles,
    selectedCommentIndex,
  } = vm;

  // Unified-list viewport geometry — the same computation DiffFileList
  // runs for rendering, so the input handler scrolls exactly what is
  // drawn.
  const layout = useMemo(
    () =>
      computeDiffListLayout({
        paneRows: terminal.paneRows,
        paneCols: terminal.paneCols,
        displayFiles,
        treeMode,
        skippedCount: diffSkippedFiles.length,
        threads: generalThreads,
        // Buffers included so spans track the compose input growing as
        // the user types — the scroll-sync hook keeps it in view.
        compose: {
          replyingToThreadId: pane.replyingToThreadId,
          replyBuffer: pane.replyBuffer,
          annotatingPlanKey: pane.annotatingPlanKey,
          annotationBuffer: pane.annotationBuffer,
        },
      }),
    [
      terminal.paneRows,
      terminal.paneCols,
      displayFiles,
      treeMode,
      diffSkippedFiles.length,
      generalThreads,
      pane.replyingToThreadId,
      pane.replyBuffer,
      pane.annotatingPlanKey,
      pane.annotationBuffer,
    ]
  );

  // Post-render scroll corrections: keep an open compose input in
  // view, anchor the viewport when item sizes change upstream, and
  // reveal a freshly-posted reply.
  useDiffListScrollSync({
    layout,
    selectedIndex: pane.diffFileIndex,
    composeMode:
      pane.replyingToThreadId != null
        ? 'reply'
        : pane.annotatingPlanKey != null
        ? 'annotate'
        : null,
    pendingScrollThreadId: pane.pendingScrollThreadId,
    setDiffListScrollRow: pane.setDiffListScrollRow,
    setPendingScrollThreadId: pane.setPendingScrollThreadId,
  });

  useInput(
    (input, key) => {
      handleDiffFileListInput(input, key, {
        pane,
        diffFiles: orderedFiles,
        diffDisplayCount,
        fileCount,
        shownGeneralComments: generalThreads,
        listSpans: layout.spans,
        listViewportRows: layout.viewportRows,
        keybinds,
        sessions,
        remoteCtx: {
          replyToThread: diffBundle.remote.replyToThread,
          toggleResolved: diffBundle.remote.toggleResolved,
          refresh: diffBundle.remote.refresh,
        },
        plan,
        prId,
      });
    },
    { isActive: !terminalFocused }
  );

  return (
    <DiffFileList
      files={orderedFiles}
      selectedIndex={pane.diffFileIndex}
      paneRows={terminal.paneRows}
      paneCols={terminal.paneCols}
      loading={diffBundle.loading}
      error={diffBundle.error}
      showSkipped={pane.showSkipped}
      comments={diffBundle.comments}
      treeMode={treeMode}
      generalComments={generalThreads}
      selectedCommentIndex={selectedCommentIndex}
      scrollRow={pane.diffListScrollRow}
      replyingToThreadId={pane.replyingToThreadId}
      replyBuffer={pane.replyBuffer}
      inPlanKeys={inPlanKeys}
      annotatingPlanKey={pane.annotatingPlanKey}
      annotationBuffer={pane.annotationBuffer}
    />
  );
}
