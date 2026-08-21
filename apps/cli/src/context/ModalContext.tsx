import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useSettings, type SettingsMode } from '../hooks/useSettings.js';
import { useBranchPicker } from '../hooks/useBranchPicker.js';
import {
  useDeleteConfirmation,
  type DeleteConfirmState,
} from '../hooks/useDeleteConfirmation.js';

// ── Modal state/actions contexts ─────────────────────────────────
//
// Three modal hooks used to live on `AppStateContext` alongside nav
// and async ops — any keystroke in one modal would re-render every
// useAppState consumer. This module hosts them on their own nested
// providers, with each modal split into a state context (changes when
// the modal state changes) and an actions context (stable setters).

// ── Settings ────────────────────────────────────────────────────

export interface SettingsStateValue {
  settingsMode: SettingsMode;
  settingsOpen: boolean;
  controlsOpen: boolean;
  settingsFieldIndex: number;
  editingField: string | null;
  editBuffer: string;
  controlsSelectedIndex: number;
  controlsRebindActionId: string | null;
}

export interface SettingsActionsValue {
  setSettingsOpen: (open: boolean) => void;
  setControlsOpen: (open: boolean) => void;
  setSettingsFieldIndex: React.Dispatch<React.SetStateAction<number>>;
  setEditingField: React.Dispatch<React.SetStateAction<string | null>>;
  setEditBuffer: React.Dispatch<React.SetStateAction<string>>;
  setControlsSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  setControlsRebindActionId: React.Dispatch<
    React.SetStateAction<string | null>
  >;
}

export type SettingsValue = SettingsStateValue & SettingsActionsValue;

const SettingsStateContext = createContext<SettingsStateValue | null>(null);
const SettingsActionsContext = createContext<SettingsActionsValue | null>(null);

// ── Branch picker ───────────────────────────────────────────────

export interface BranchPickerStateValue {
  creating: boolean;
  branchFilter: string;
  branchIndex: number;
  branches: string[];
}

export interface BranchPickerActionsValue {
  setCreating: React.Dispatch<React.SetStateAction<boolean>>;
  setBranchFilter: React.Dispatch<React.SetStateAction<string>>;
  setBranchIndex: React.Dispatch<React.SetStateAction<number>>;
  setBranches: React.Dispatch<React.SetStateAction<string[]>>;
}

export type BranchPickerValue = BranchPickerStateValue &
  BranchPickerActionsValue;

const BranchPickerStateContext = createContext<BranchPickerStateValue | null>(
  null
);
const BranchPickerActionsContext =
  createContext<BranchPickerActionsValue | null>(null);

// ── Delete confirm ──────────────────────────────────────────────

export interface DeleteConfirmStateValue {
  confirmDelete: DeleteConfirmState | null;
  confirmInput: string;
}

export interface DeleteConfirmActionsValue {
  setConfirmDelete: React.Dispatch<
    React.SetStateAction<DeleteConfirmState | null>
  >;
  setConfirmInput: React.Dispatch<React.SetStateAction<string>>;
}

export type DeleteConfirmValue = DeleteConfirmStateValue &
  DeleteConfirmActionsValue;

const DeleteConfirmStateContext = createContext<DeleteConfirmStateValue | null>(
  null
);
const DeleteConfirmActionsContext =
  createContext<DeleteConfirmActionsValue | null>(null);

// ── Provider ────────────────────────────────────────────────────

export function ModalProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const branchPicker = useBranchPicker();
  const deleteConfirm = useDeleteConfirmation();

  const settingsState = useMemo<SettingsStateValue>(
    () => ({
      settingsMode: settings.settingsMode,
      settingsOpen: settings.settingsOpen,
      controlsOpen: settings.controlsOpen,
      settingsFieldIndex: settings.settingsFieldIndex,
      editingField: settings.editingField,
      editBuffer: settings.editBuffer,
      controlsSelectedIndex: settings.controlsSelectedIndex,
      controlsRebindActionId: settings.controlsRebindActionId,
    }),
    [
      settings.settingsMode,
      settings.settingsOpen,
      settings.controlsOpen,
      settings.settingsFieldIndex,
      settings.editingField,
      settings.editBuffer,
      settings.controlsSelectedIndex,
      settings.controlsRebindActionId,
    ]
  );

  const settingsActions = useMemo<SettingsActionsValue>(
    () => ({
      setSettingsOpen: settings.setSettingsOpen,
      setControlsOpen: settings.setControlsOpen,
      setSettingsFieldIndex: settings.setSettingsFieldIndex,
      setEditingField: settings.setEditingField,
      setEditBuffer: settings.setEditBuffer,
      setControlsSelectedIndex: settings.setControlsSelectedIndex,
      setControlsRebindActionId: settings.setControlsRebindActionId,
    }),
    [
      settings.setSettingsOpen,
      settings.setControlsOpen,
      settings.setSettingsFieldIndex,
      settings.setEditingField,
      settings.setEditBuffer,
      settings.setControlsSelectedIndex,
      settings.setControlsRebindActionId,
    ]
  );

  const branchPickerState = useMemo<BranchPickerStateValue>(
    () => ({
      creating: branchPicker.creating,
      branchFilter: branchPicker.branchFilter,
      branchIndex: branchPicker.branchIndex,
      branches: branchPicker.branches,
    }),
    [
      branchPicker.creating,
      branchPicker.branchFilter,
      branchPicker.branchIndex,
      branchPicker.branches,
    ]
  );

  const branchPickerActions = useMemo<BranchPickerActionsValue>(
    () => ({
      setCreating: branchPicker.setCreating,
      setBranchFilter: branchPicker.setBranchFilter,
      setBranchIndex: branchPicker.setBranchIndex,
      setBranches: branchPicker.setBranches,
    }),
    [
      branchPicker.setCreating,
      branchPicker.setBranchFilter,
      branchPicker.setBranchIndex,
      branchPicker.setBranches,
    ]
  );

  const deleteConfirmState = useMemo<DeleteConfirmStateValue>(
    () => ({
      confirmDelete: deleteConfirm.confirmDelete,
      confirmInput: deleteConfirm.confirmInput,
    }),
    [deleteConfirm.confirmDelete, deleteConfirm.confirmInput]
  );

  const deleteConfirmActions = useMemo<DeleteConfirmActionsValue>(
    () => ({
      setConfirmDelete: deleteConfirm.setConfirmDelete,
      setConfirmInput: deleteConfirm.setConfirmInput,
    }),
    [deleteConfirm.setConfirmDelete, deleteConfirm.setConfirmInput]
  );

  return (
    <SettingsStateContext.Provider value={settingsState}>
      <SettingsActionsContext.Provider value={settingsActions}>
        <BranchPickerStateContext.Provider value={branchPickerState}>
          <BranchPickerActionsContext.Provider value={branchPickerActions}>
            <DeleteConfirmStateContext.Provider value={deleteConfirmState}>
              <DeleteConfirmActionsContext.Provider
                value={deleteConfirmActions}
              >
                {children}
              </DeleteConfirmActionsContext.Provider>
            </DeleteConfirmStateContext.Provider>
          </BranchPickerActionsContext.Provider>
        </BranchPickerStateContext.Provider>
      </SettingsActionsContext.Provider>
    </SettingsStateContext.Provider>
  );
}

// ── Hooks ────────────────────────────────────────────────────────

export function useSettingsState(): SettingsStateValue {
  const ctx = useContext(SettingsStateContext);
  if (!ctx)
    throw new Error('useSettingsState must be used within ModalProvider');
  return ctx;
}

export function useSettingsActions(): SettingsActionsValue {
  const ctx = useContext(SettingsActionsContext);
  if (!ctx)
    throw new Error('useSettingsActions must be used within ModalProvider');
  return ctx;
}

export function useBranchPickerState(): BranchPickerStateValue {
  const ctx = useContext(BranchPickerStateContext);
  if (!ctx)
    throw new Error('useBranchPickerState must be used within ModalProvider');
  return ctx;
}

export function useBranchPickerActions(): BranchPickerActionsValue {
  const ctx = useContext(BranchPickerActionsContext);
  if (!ctx)
    throw new Error('useBranchPickerActions must be used within ModalProvider');
  return ctx;
}

export function useDeleteConfirmState(): DeleteConfirmStateValue {
  const ctx = useContext(DeleteConfirmStateContext);
  if (!ctx)
    throw new Error('useDeleteConfirmState must be used within ModalProvider');
  return ctx;
}

export function useDeleteConfirmActions(): DeleteConfirmActionsValue {
  const ctx = useContext(DeleteConfirmActionsContext);
  if (!ctx)
    throw new Error(
      'useDeleteConfirmActions must be used within ModalProvider'
    );
  return ctx;
}
