import { useMemo } from 'react';
import { useInput } from 'ink';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { partitionFiles } from '@kirby/diff';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import { useDiffData } from '../../hooks/useDiffData.js';
import { useReviewComments } from '../../hooks/useReviewComments.js';
import { handleDiffFileListInput } from './main-input.js';

interface DiffFileListContainerProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  selectedPr: PullRequestInfo | undefined;
  terminalFocused: boolean;
}

// Owns the file-list half of the old DiffPane: fetches the file list
// for the selected PR, reads inline review comments for badge counts,
// and routes diff-list keypresses. Mounted by MainContent when
// paneMode === 'diff'.
export function DiffFileListContainer({
  pane,
  terminal,
  selectedPr,
  terminalFocused,
}: DiffFileListContainerProps) {
  const keybinds = useKeybindResolve();

  const reviewComments = useReviewComments(selectedPr?.id ?? null);

  const diffData = useDiffData(
    selectedPr?.id ?? null,
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

  useInput(
    (input, key) => {
      handleDiffFileListInput(input, key, {
        pane,
        diffFiles: diffData.files,
        diffDisplayCount,
        loadDiffText: diffData.loadDiffText,
        keybinds,
      });
    },
    { isActive: !terminalFocused }
  );

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
