import type { PullRequestInfo } from '@kirby/vcs-core';
import { BranchPicker } from '../sessions/BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { ControlsPanel } from '../../components/ControlsPanel.js';
import { ReviewConfirmPane } from '../reviews/ReviewConfirmPane.js';
import { ReviewDetailPane } from '../reviews/ReviewDetailPane.js';
import { TerminalPane } from './TerminalPane.js';
import { DiffPane } from './DiffPane.js';
import type { TerminalLayout } from '../../context/LayoutContext.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import { useAppState } from '../../context/AppStateContext.js';

interface MainContentProps {
  pane: PaneModeValue;
  terminal: TerminalLayout;
  terminalFocused: boolean;
  sessionNameForTerminal: string | null;
  selectedPr: PullRequestInfo | undefined;
  onFocusSidebar: () => void;
}

// Pure router for the main content pane. Renders exactly one of the
// mutually-exclusive sub-panes based on modal and pane-mode state, in
// the same precedence order MainTab used to inline. Extracted from
// MainTab so MainTab can focus on the layout shell (Sidebar + Pane +
// DeleteConfirmModal overlay) without drowning in conditional JSX.
//
// Precedence (highest first):
//   1. Controls sub-screen  → ControlsPanel
//   2. Settings             → SettingsPanel
//   3. Branch picker        → BranchPicker
//   4. Review confirm       → ReviewConfirmPane
//   5. Terminal mode        → TerminalPane
//   6. PR detail mode       → ReviewDetailPane
//   7. Diff mode            → DiffPane
export function MainContent({
  pane,
  terminal,
  terminalFocused,
  sessionNameForTerminal,
  selectedPr,
  onFocusSidebar,
}: MainContentProps) {
  const { settings, branchPicker } = useAppState();

  if (settings.settingsOpen && settings.controlsOpen) {
    return (
      <ControlsPanel
        paneRows={terminal.paneRows}
        selectedIndex={settings.controlsSelectedIndex}
        rebindActionId={settings.controlsRebindActionId}
      />
    );
  }
  if (settings.settingsOpen) {
    return (
      <SettingsPanel
        fieldIndex={settings.settingsFieldIndex}
        editingField={settings.editingField}
        editBuffer={settings.editBuffer}
      />
    );
  }
  if (branchPicker.creating) {
    return (
      <BranchPicker
        filter={branchPicker.branchFilter}
        branches={branchPicker.branches}
        selectedIndex={branchPicker.branchIndex}
        paneRows={terminal.paneRows}
      />
    );
  }
  if (pane.reviewConfirm) {
    return (
      <ReviewConfirmPane
        pr={pane.reviewConfirm.pr}
        selectedOption={pane.reviewConfirm.selectedOption}
        instruction={pane.reviewInstruction}
      />
    );
  }
  if (pane.paneMode === 'terminal') {
    return (
      <TerminalPane
        sessionNameForTerminal={sessionNameForTerminal}
        terminal={terminal}
        reconnectKey={pane.reconnectKey}
        terminalFocused={terminalFocused}
        onFocusSidebar={onFocusSidebar}
      />
    );
  }
  if (pane.paneMode === 'pr-detail') {
    return <ReviewDetailPane pr={selectedPr} />;
  }
  if (pane.paneMode === 'diff' || pane.paneMode === 'diff-file') {
    return (
      <DiffPane
        pane={pane}
        terminal={terminal}
        selectedPr={selectedPr}
        terminalFocused={terminalFocused}
      />
    );
  }
  return null;
}
