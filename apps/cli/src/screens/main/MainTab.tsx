import { useMemo } from 'react';
import { useInput } from 'ink';
import { Sidebar } from '../../components/Sidebar.js';
import { Pane } from '../../components/Pane.js';
import { useNavState, useNavActions } from '../../context/NavContext.js';
import { useAsyncOps } from '../../context/AsyncOpsContext.js';
import {
  useBranchPickerState,
  useBranchPickerActions,
  useDeleteConfirmState,
  useDeleteConfirmActions,
  useSettingsState,
  useSettingsActions,
} from '../../context/ModalContext.js';
import { useLayout, LAYOUT } from '../../context/LayoutContext.js';
import { useSessionActions } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { useKeybinds } from '../../context/KeybindContext.js';
import { useSidebar } from '../../context/SidebarContext.js';
import { usePaneReducer } from '../../hooks/usePaneReducer.js';
import { getItemKey } from '../../types.js';
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
import { MainContent } from './MainContent.js';
import { getMainFocused, getSidebarFocused, getPaneTitle } from './focus.js';

interface MainTabProps {
  terminalFocused: boolean;
  showOnboarding: boolean;
  exit: () => void;
}

// MainTab holds an always-on no-op useInput to keep Ink's raw-mode
// ref-count above zero while MainTabBody remounts on sidebar-item
// changes. Without this guard the selected-item remount would briefly
// tear down the only useInput in the tree, flipping raw-mode off and
// causing character echo in the terminal.
export function MainTab(props: MainTabProps) {
  useInput(() => {
    // Intentionally empty — see comment above.
  });

  const sidebar = useSidebar();
  const itemKey = sidebar.selectedItem
    ? getItemKey(sidebar.selectedItem)
    : 'empty';

  return <MainTabBody key={itemKey} {...props} />;
}

// MainTabBody owns the pane state + the real input router. React
// unmounts and remounts it whenever `itemKey` changes (see MainTab
// above), so `usePaneReducer`'s lazy initializer picks a fresh pane
// mode via defaultPaneMode() — no render-time setState to reset.
function MainTabBody({ terminalFocused, showOnboarding, exit }: MainTabProps) {
  const navState = useNavState();
  const navActions = useNavActions();
  const nav = useMemo(
    () => ({ ...navState, ...navActions }),
    [navState, navActions]
  );
  const asyncOps = useAsyncOps();
  const branchPickerState = useBranchPickerState();
  const branchPickerActions = useBranchPickerActions();
  const deleteConfirmState = useDeleteConfirmState();
  const deleteConfirmActions = useDeleteConfirmActions();
  const settingsState = useSettingsState();
  const settingsActions = useSettingsActions();
  const branchPicker = useMemo(
    () => ({ ...branchPickerState, ...branchPickerActions }),
    [branchPickerState, branchPickerActions]
  );
  const deleteConfirm = useMemo(
    () => ({ ...deleteConfirmState, ...deleteConfirmActions }),
    [deleteConfirmState, deleteConfirmActions]
  );
  const settings = useMemo(
    () => ({ ...settingsState, ...settingsActions }),
    [settingsState, settingsActions]
  );
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
  // Single source of truth for which pane shows the active border color.
  // Both getMainFocused and getSidebarFocused are pure helpers (see
  // ./focus.ts) that stay aligned with the actual input sink — crucially,
  // diff modes count as main-focused because DiffPane.useInput is the
  // real input handler there, not the sidebar.
  const focusState = {
    navFocus: nav.focus,
    paneMode: pane.paneMode,
    branchPickerCreating: branchPicker.creating,
    settingsOpen: settings.settingsOpen,
    reviewConfirmActive: pane.reviewConfirm !== null,
    deleteConfirmActive: deleteConfirm.confirmDelete !== null,
  };
  const mainFocused = getMainFocused(focusState);
  const sidebarFocused = getSidebarFocused(focusState);

  const paneTitle = getPaneTitle({
    paneMode: pane.paneMode,
    branchPickerCreating: branchPicker.creating,
    settingsOpen: settings.settingsOpen,
    controlsOpen: settings.controlsOpen,
    reviewConfirmActive: pane.reviewConfirm !== null,
    aiCommand: configCtx.config.aiCommand,
    prTitle: sidebar.selectedPr?.title,
    sessionName: sidebar.sessionNameForTerminal,
    terminalFocused,
  });

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
        paneCols: Math.max(20, layout.termCols - LAYOUT.PANE_BORDER_COLS),
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
      <Pane focused={mainFocused} title={paneTitle} flexGrow={1}>
        <MainContent
          pane={pane}
          terminal={effectiveTerminal}
          terminalFocused={terminalFocused}
          sessionNameForTerminal={sidebar.sessionNameForTerminal}
          selectedPr={sidebar.selectedPr}
          onFocusSidebar={() => nav.setFocus('sidebar')}
        />
      </Pane>
    </>
  );
}
