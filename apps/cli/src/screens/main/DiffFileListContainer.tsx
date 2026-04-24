import { useMemo } from 'react';
import { useInput } from 'ink';
import { partitionFiles } from '@kirby/diff';
import { DiffFileList } from '../reviews/DiffFileList.js';
import { useKeybindResolve } from '../../context/KeybindContext.js';
import { useConfig } from '../../context/ConfigContext.js';
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
  const diffDisplayCount = pane.showSkipped
    ? diffNormalFiles.length + diffSkippedFiles.length
    : diffNormalFiles.length;

  useInput(
    (input, key) => {
      handleDiffFileListInput(input, key, {
        pane,
        diffFiles: orderedFiles,
        diffDisplayCount,
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
    />
  );
}
