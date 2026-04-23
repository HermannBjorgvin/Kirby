import type { PullRequestInfo } from '@kirby/vcs-core';
import { BranchPicker } from '../sessions/BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { ControlsPanel } from '../../components/ControlsPanel.js';
import { ReviewConfirmPane } from '../reviews/ReviewConfirmPane.js';
import { ReviewDetailPane } from '../reviews/ReviewDetailPane.js';
import { TerminalPane } from './TerminalPane.js';
import { DiffFileListContainer } from './DiffFileListContainer.js';
import { DiffFileViewerContainer } from './DiffFileViewerContainer.js';
import { GeneralCommentsContainer } from './GeneralCommentsContainer.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import { useDiffBundle } from '../../hooks/useDiffBundle.js';
import {
  useSettingsState,
  useBranchPickerState,
} from '../../context/ModalContext.js';

interface MainContentProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  terminalFocused: boolean;
  sessionNameForTerminal: string | null;
  selectedPr: PullRequestInfo | undefined;
  onFocusSidebar: () => void;
}

type ScreenType =
  | 'controls'
  | 'settings'
  | 'branchPicker'
  | 'reviewConfirm'
  | 'terminal'
  | 'prDetail'
  | 'diff'
  | 'diffFile'
  | 'comments';

// Pure router for the main content pane. Renders exactly one of the
// mutually-exclusive sub-panes based on modal and pane-mode state, in
// the same precedence order MainTab used to inline.
//
// Precedence (highest first):
//   1. Controls sub-screen  → ControlsPanel
//   2. Settings             → SettingsPanel
//   3. Branch picker        → BranchPicker
//   4. Review confirm       → ReviewConfirmPane
//   5. Terminal mode        → TerminalPane
//   6. PR detail mode       → ReviewDetailPane
//   7. Diff list            → DiffPane
//   8. Diff file viewer     → DiffPane
export function MainContent({
  pane,
  terminal,
  terminalFocused,
  sessionNameForTerminal,
  selectedPr,
  onFocusSidebar,
}: MainContentProps) {
  const settings = useSettingsState();
  const branchPicker = useBranchPickerState();

  // One diff-data instance shared by the list + viewer containers.
  // Mounted unconditionally so the in-memory file/diff cache and the
  // fs.watch on the comments dir survive the list→viewer switch.
  const diffBundle = useDiffBundle(
    selectedPr?.id ?? null,
    selectedPr?.sourceBranch ?? '',
    selectedPr?.targetBranch ?? ''
  );

  const screenType: ScreenType = (() => {
    if (settings.settingsOpen && settings.controlsOpen) return 'controls';
    if (settings.settingsOpen) return 'settings';
    if (branchPicker.creating) return 'branchPicker';
    if (pane.reviewConfirm) return 'reviewConfirm';
    if (pane.paneMode === 'pr-detail') return 'prDetail';
    if (pane.paneMode === 'diff') return 'diff';
    if (pane.paneMode === 'diff-file') return 'diffFile';
    if (pane.paneMode === 'comments') return 'comments';
    return 'terminal';
  })();

  switch (screenType) {
    case 'controls':
      return (
        <ControlsPanel
          paneRows={terminal.paneRows}
          selectedIndex={settings.controlsSelectedIndex}
          rebindActionId={settings.controlsRebindActionId}
        />
      );
    case 'settings':
      return (
        <SettingsPanel
          fieldIndex={settings.settingsFieldIndex}
          editingField={settings.editingField}
          editBuffer={settings.editBuffer}
        />
      );
    case 'branchPicker':
      return (
        <BranchPicker
          filter={branchPicker.branchFilter}
          branches={branchPicker.branches}
          selectedIndex={branchPicker.branchIndex}
          paneRows={terminal.paneRows}
        />
      );
    case 'reviewConfirm':
      return (
        <ReviewConfirmPane
          pr={pane.reviewConfirm!.pr}
          selectedOption={pane.reviewConfirm!.selectedOption}
          instruction={pane.reviewInstruction}
        />
      );
    case 'terminal':
      return (
        <TerminalPane
          sessionNameForTerminal={sessionNameForTerminal}
          terminal={terminal}
          reconnectKey={pane.reconnectKey}
          terminalFocused={terminalFocused}
          onFocusSidebar={onFocusSidebar}
        />
      );
    case 'prDetail':
      return <ReviewDetailPane pr={selectedPr} />;
    case 'diff':
      return (
        <DiffFileListContainer
          pane={pane}
          terminal={terminal}
          terminalFocused={terminalFocused}
          diffBundle={diffBundle}
        />
      );
    case 'diffFile':
      return (
        <DiffFileViewerContainer
          pane={pane}
          terminal={terminal}
          selectedPr={selectedPr}
          terminalFocused={terminalFocused}
          diffBundle={diffBundle}
        />
      );
    case 'comments':
      return (
        <GeneralCommentsContainer
          pane={pane}
          terminal={terminal}
          terminalFocused={terminalFocused}
          diffBundle={diffBundle}
        />
      );
  }
}
