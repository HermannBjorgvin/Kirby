import { useInput } from 'ink';
import { SessionsSidebar } from './SessionsSidebar.js';
import { TerminalView } from '../../components/TerminalView.js';
import { BranchPicker } from './BranchPicker.js';
import { SettingsPanel } from '../../components/SettingsPanel.js';
import { useAppState } from '../../context/AppStateContext.js';
import { useSessionContext } from '../../context/SessionContext.js';
import { useConfig } from '../../context/ConfigContext.js';
import { handleSettingsInput } from '../../input-handlers.js';
import {
  handleBranchPickerInput,
  handleConfirmDeleteInput,
  handleSessionsSidebarInput,
} from './sessions-input.js';
interface SessionsTabProps {
  reconnectKey: number;
  setReconnectKey: (v: (prev: number) => number) => void;
  terminalContent: string;
  terminalFocused: boolean;
  showOnboarding: boolean;
  exit: () => void;
}

export function SessionsTab({
  reconnectKey,
  setReconnectKey,
  terminalContent,
  terminalFocused,
  showOnboarding,
  exit,
}: SessionsTabProps) {
  const appState = useAppState();
  const { nav, asyncOps, branchPicker, deleteConfirm, settings, terminal } =
    appState;
  const sessionCtx = useSessionContext();
  const configCtx = useConfig();

  useInput(
    (input, key) => {
      if (terminalFocused) return;
      if (showOnboarding) return;
      if (branchPicker.creating)
        return handleBranchPickerInput(input, key, {
          branchPicker,
          sessions: sessionCtx,
          asyncOps,
          terminal,
          config: configCtx,
        });
      if (deleteConfirm.confirmDelete)
        return handleConfirmDeleteInput(input, key, {
          deleteConfirm,
          sessions: sessionCtx,
          asyncOps,
        });
      if (settings.settingsOpen)
        return handleSettingsInput(input, key, {
          settings,
          config: configCtx,
          sessions: sessionCtx,
        });
      handleSessionsSidebarInput(input, key, {
        nav,
        config: configCtx,
        sessions: sessionCtx,
        branchPicker,
        deleteConfirm,
        settings,
        asyncOps,
        terminal,
        reconnectKey,
        setReconnectKey,
        exit,
      });
    },
    { isActive: nav.activeTab === 'sessions' }
  );

  return (
    <>
      <SessionsSidebar
        sessions={sessionCtx.sortedSessions}
        selectedIndex={sessionCtx.clampedSelectedIndex}
        focused={
          nav.focus === 'sidebar' &&
          !branchPicker.creating &&
          !settings.settingsOpen
        }
        sessionBranchMap={sessionCtx.sessionBranchMap}
        sessionPrMap={sessionCtx.sessionPrMap}
        sidebarWidth={appState.sidebarWidth}
        orphanPrs={sessionCtx.orphanPrs}
        mergedBranches={sessionCtx.mergedBranches}
        conflictCounts={sessionCtx.conflictCounts}
        conflictsLoading={sessionCtx.conflictsLoading}
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
        <TerminalView
          content={terminalContent}
          focused={nav.focus === 'terminal'}
        />
      )}
    </>
  );
}
