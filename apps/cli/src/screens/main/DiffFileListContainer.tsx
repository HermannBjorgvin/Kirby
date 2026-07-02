import { useMemo } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { partitionFiles } from '@kirby/diff';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { computeDiffListLayout } from '../reviews/diff-list-layout.js';
import { useDiffListScrollSync } from '../../hooks/useDiffListScrollSync.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { usePlan } from '../../context/PlanContext.js';
import { planItemKey } from '../../plan/plan-types.js';
import { planCommentFooter } from '../../components/CommentThread.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { DiffBundle } from '../../hooks/useDiffBundle.js';
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
  const { config } = useConfig();
  const treeMode = config.diffFileListTree === true;

  const prId = selectedPr?.id;
  const inPlanKeys = useMemo(() => {
    const m = new Map<string, boolean>();
    if (prId != null) {
      for (const i of plan.list(prId)) {
        m.set(planItemKey(i.kind, i.id), !!i.annotation);
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- plan.snapshot drives freshness
  }, [prId, plan.snapshot]);

  // In tree mode, sort files alphabetically by path so siblings group
  // under the same dir. Hoisted here so the ordering is shared with
  // the input handler — selection index must point at the same file
  // the renderer highlights.
  const orderedFiles = useMemo(
    () =>
      treeMode
        ? [...diffBundle.files].sort((a, b) =>
            a.filename.localeCompare(b.filename)
          )
        : diffBundle.files,
    [diffBundle.files, treeMode]
  );

  const { normal: diffNormalFiles, skipped: diffSkippedFiles } = useMemo(
    () => partitionFiles(orderedFiles),
    [orderedFiles]
  );
  const fileCount = pane.showSkipped
    ? diffNormalFiles.length + diffSkippedFiles.length
    : diffNormalFiles.length;

  // j/k walks files first, then extends into the rendered PR-comments
  // footer. `shown` has to match what DiffFileList will actually draw
  // (same planCommentFooter call there), otherwise selection could
  // land on an invisible card.
  const generalThreads = diffBundle.remote.generalComments;
  const { shown: shownGeneral } = useMemo(
    () => planCommentFooter(generalThreads),
    [generalThreads]
  );
  const diffDisplayCount = fileCount + shownGeneral.length;

  // Unified-list viewport geometry — the same computation DiffFileList
  // runs for rendering, so the input handler scrolls exactly what is
  // drawn.
  const displayFiles = useMemo(
    () =>
      pane.showSkipped
        ? [...diffNormalFiles, ...diffSkippedFiles]
        : diffNormalFiles,
    [diffNormalFiles, diffSkippedFiles, pane.showSkipped]
  );
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

  // Selection breakdown: indices [0, fileCount) select a file; indices
  // [fileCount, diffDisplayCount) select a footer comment (offset by
  // -fileCount). selectedCommentIndex is undefined when a file is
  // highlighted so the list component knows to leave cards unselected.
  const selectedCommentIndex =
    pane.diffFileIndex >= fileCount
      ? pane.diffFileIndex - fileCount
      : undefined;

  useInput(
    (input, key) => {
      handleDiffFileListInput(input, key, {
        pane,
        diffFiles: orderedFiles,
        diffDisplayCount,
        fileCount,
        shownGeneralComments: shownGeneral,
        listSpans: layout.spans,
        listViewportRows: layout.viewportRows,
        keybinds,
        sessions,
        remoteCtx: {
          replyToThread: diffBundle.remote.replyToThread,
          toggleResolved: diffBundle.remote.toggleResolved,
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
