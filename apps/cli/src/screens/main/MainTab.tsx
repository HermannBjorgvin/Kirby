import { useInput } from 'ink';
import { Sidebar } from '../../components/Sidebar.js';
import { BranchPicker } from '../sessions/BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { ReviewConfirmPane } from '../reviews/ReviewConfirmPane.js';
import { ReviewDetailPane } from '../reviews/ReviewDetailPane.js';
import { useAppState } from '../../context/AppStateContext.js';
import { useLayout } from '../../context/LayoutContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useSidebar } from '../../context/SidebarContext.js';
import { usePaneReducer } from '../../hooks/usePaneReducer.js';
import { handleSettingsInput } from '../../input-handlers.js';
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleConfirmInput,
  handleSidebarInput,
} from './main-input.js';
import { TerminalPane } from './TerminalPane.js';
import { DiffPane } from './DiffPane.js';

interface MainTabProps {
  terminalFocused: boolean;
  showOnboarding: boolean;
  exit: () => void;
}

export function MainTab({
  terminalFocused,
  showOnboarding,
  exit,
}: MainTabProps) {
  const { nav, asyncOps, branchPicker, deleteConfirm, settings } =
    useAppState();
  const layout = useLayout();
  const { terminal } = layout;
  const sessionCtx = useSessionActions();
  const configCtx = useConfig();
  const sidebar = useSidebar();

  const pane = usePaneReducer(
    sidebar.selectedItem,
    sidebar.sessionNameForTerminal
  );

  // ── Input handling (modals + sidebar) ──────────────────────────
  useInput(
    (input, key) => {
      if (branchPicker.creating) {
        return handleBranchPickerInput(input, key, {
          branchPicker,
          sessions: sessionCtx,
          asyncOps,
          terminal,
          config: configCtx,
        });
      }

      if (deleteConfirm.confirmDelete) {
        return handleConfirmDeleteInput(input, key, {
          deleteConfirm,
          sessions: sessionCtx,
          asyncOps,
        });
      }

      if (settings.settingsOpen) {
        return handleSettingsInput(input, key, {
          settings,
          config: configCtx,
          sessions: sessionCtx,
        });
      }

      if (pane.reviewConfirm) {
        return handleConfirmInput(input, key, {
          pane,
          nav,
          asyncOps,
          sessions: sessionCtx,
          sidebar,
          terminal,
          config: configCtx,
          selectedItem: sidebar.selectedItem,
          sessionNameForTerminal: sidebar.sessionNameForTerminal,
        });
      }

      // Diff input is handled by DiffPane's own useInput
      if (pane.paneMode === 'diff' || pane.paneMode === 'diff-file') return;

      handleSidebarInput(input, key, {
        nav,
        config: configCtx,
        sessions: sessionCtx,
        sidebar,
        branchPicker,
        deleteConfirm,
        settings,
        asyncOps,
        terminal,
        pane,
        exit,
      });
    },
    { isActive: !terminalFocused && !showOnboarding }
  );

  // ── Render ─────────────────────────────────────────────────────
  const sidebarFocused =
    nav.focus === 'sidebar' &&
    !branchPicker.creating &&
    !settings.settingsOpen &&
    !pane.reviewConfirm;

  return (
    <>
      <Sidebar
        items={sidebar.items}
        selectedIndex={sidebar.clampedIndex}
        sidebarWidth={layout.sidebarWidth}
        termRows={layout.termRows}
        focused={sidebarFocused}
      />
      {settings.settingsOpen && (
        <SettingsPanel
          fieldIndex={settings.settingsFieldIndex}
          editingField={settings.editingField}
          editBuffer={settings.editBuffer}
        />
      )}
      {!settings.settingsOpen && branchPicker.creating && (
        <BranchPicker
          filter={branchPicker.branchFilter}
          branches={branchPicker.branches}
          selectedIndex={branchPicker.branchIndex}
          paneRows={terminal.paneRows}
        />
      )}
      {!settings.settingsOpen && !branchPicker.creating && (
        <>
          {pane.reviewConfirm && (
            <ReviewConfirmPane
              pr={pane.reviewConfirm.pr}
              selectedOption={pane.reviewConfirm.selectedOption}
              instruction={pane.reviewInstruction}
            />
          )}
          {!pane.reviewConfirm && pane.paneMode === 'terminal' && (
            <TerminalPane
              sessionNameForTerminal={sidebar.sessionNameForTerminal}
              terminal={terminal}
              reconnectKey={pane.reconnectKey}
              terminalFocused={terminalFocused}
              onFocusSidebar={() => nav.setFocus('sidebar')}
            />
          )}
          {!pane.reviewConfirm && pane.paneMode === 'pr-detail' && (
            <ReviewDetailPane pr={sidebar.selectedPr} />
          )}
          {!pane.reviewConfirm &&
            (pane.paneMode === 'diff' || pane.paneMode === 'diff-file') && (
              <DiffPane
                pane={pane}
                terminal={terminal}
                selectedPr={sidebar.selectedPr}
                terminalFocused={terminalFocused}
              />
            )}
        </>
      )}
    </>
  );
}
