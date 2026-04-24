import { useMemo } from 'react';
import { useInput } from 'ink';
import { partitionFiles } from '@kirby/diff';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { planCommentFooter } from '../../components/CommentThread.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { DiffBundle } from '../../hooks/useDiffBundle.js';
import { handleDiffFileListInput } from './main-input.js';

interface DiffFileListContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
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
  terminalFocused,
  diffBundle,
}: DiffFileListContainerProps) {
  const keybinds = useKeybindResolve();
  const { config } = useConfig();
  const treeMode = config.diffFileListTree === true;

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
    () => planCommentFooter(generalThreads, terminal.paneRows),
    [generalThreads, terminal.paneRows]
  );
  const diffDisplayCount = fileCount + shownGeneral.length;

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
        loadDiffText: diffBundle.loadDiffText,
        keybinds,
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
    />
  );
}
