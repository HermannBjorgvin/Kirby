import { useMemo } from 'react';
import { useInput } from 'ink';
import { partitionFiles } from '@kirby/diff';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
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

  const { normal: diffNormalFiles, skipped: diffSkippedFiles } = useMemo(
    () => partitionFiles(diffBundle.files),
    [diffBundle.files]
  );
  const diffDisplayCount = pane.showSkipped
    ? diffNormalFiles.length + diffSkippedFiles.length
    : diffNormalFiles.length;

  useInput(
    (input, key) => {
      handleDiffFileListInput(input, key, {
        pane,
        diffFiles: diffBundle.files,
        diffDisplayCount,
        loadDiffText: diffBundle.loadDiffText,
        keybinds,
      });
    },
    { isActive: !terminalFocused }
  );

  return (
    <DiffFileList
      files={diffBundle.files}
      selectedIndex={pane.diffFileIndex}
      paneRows={terminal.paneRows}
      paneCols={terminal.paneCols}
      loading={diffBundle.loading}
      error={diffBundle.error}
      showSkipped={pane.showSkipped}
      comments={diffBundle.comments}
    />
  );
}
