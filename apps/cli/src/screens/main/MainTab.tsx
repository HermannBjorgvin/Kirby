import { useInput } from 'ink';
import { Sidebar } from '../../components/Sidebar.js';
import { BranchPicker } from '../sessions/BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { ControlsPanel } from '../../components/ControlsPanel.js';
import { ReviewConfirmPane } from '../reviews/ReviewConfirmPane.js';
import { ReviewDetailPane } from '../reviews/ReviewDetailPane.js';
import { useAppState } from '../../context/AppStateContext.js';
import { useLayout } from '../../context/LayoutContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useKeybinds } from '../../context/KeybindContext.js';
import { useSidebar } from '../../context/SidebarContext.js';
import { usePaneReducer } from '../../hooks/usePaneReducer.js';
import {
  handleSettingsInput,
  handleControlsInput,
} from '../../input-handlers.js';
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
  const keybinds = useKeybinds();
  const sidebar = useSidebar();

  const pane = usePaneReducer(
    sidebar.selectedItem,
    sidebar.sessionNameForTerminal
  );

  // ── Input handling (modals + sidebar) ──────────────────────────
  useInput((input, key) => {
    // Keep this hook always active (no `isActive` option) so Ink's raw-mode
    // ref-count never drops to 0. Using `isActive: false` triggers
    // setRawMode(false), which disables raw mode and causes character echo.
    if (terminalFocused || showOnboarding) return;

    if (branchPicker.creating) {
      return handleBranchPickerInput(input, key, {
        branchPicker,
        sessions: sessionCtx,
        sidebar,
        asyncOps,
        terminal,
        config: configCtx,
        keybinds,
      });
    }

    if (deleteConfirm.confirmDelete) {
      return handleConfirmDeleteInput(input, key, {
        deleteConfirm,
        sessions: sessionCtx,
        asyncOps,
        keybinds,
      });
    }

    // Controls sub-screen (within settings)
    if (settings.settingsOpen && settings.controlsOpen) {
      return handleControlsInput(input, key, {
        settings,
        keybinds,
      });
    }

    if (settings.settingsOpen) {
      return handleSettingsInput(input, key, {
        settings,
        config: configCtx,
        sessions: sessionCtx,
        keybinds,
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
        keybinds,
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
      keybinds,
      exit,
    });
  });

  // ── Render ─────────────────────────────────────────────────────
  const sidebarFocused =
    nav.focus === 'sidebar' &&
    !branchPicker.creating &&
    !settings.settingsOpen &&
    !pane.reviewConfirm;

  // Auto-hide the sidebar while the user is driving an agent session or
  // scanning a diff, so the content pane can reclaim the full width.
  // undefined → default on; explicit false opts out.
  const autoHideEnabled = configCtx.config.autoHideSidebar !== false;
  const hideablePaneMode =
    pane.paneMode === 'terminal' ||
    pane.paneMode === 'diff' ||
    pane.paneMode === 'diff-file';
  const sidebarHidden =
    autoHideEnabled && nav.focus === 'terminal' && hideablePaneMode;

  const effectiveTerminal = sidebarHidden
    ? {
        paneCols: Math.max(20, layout.termCols - 2),
        paneRows: terminal.paneRows,
      }
    : terminal;

  return (
    <>
      {!sidebarHidden && (
        <Sidebar
          items={sidebar.items}
          selectedIndex={sidebar.selectedIndex}
          sidebarWidth={layout.sidebarWidth}
          termRows={layout.termRows}
          focused={sidebarFocused}
        />
      )}
      {settings.settingsOpen && settings.controlsOpen && (
        <ControlsPanel
          paneRows={terminal.paneRows}
          selectedIndex={settings.controlsSelectedIndex}
          rebindActionId={settings.controlsRebindActionId}
        />
      )}
      {settings.settingsOpen && !settings.controlsOpen && (
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
              terminal={effectiveTerminal}
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
                terminal={effectiveTerminal}
                selectedPr={sidebar.selectedPr}
                terminalFocused={terminalFocused}
              />
            )}
        </>
      )}
    </>
  );
}
