import { useState, useCallback } from 'react';

export type SettingsMode = 'closed' | 'settings' | 'controls';

export function useSettings() {
  const [settingsMode, setSettingsMode] = useState<SettingsMode>('closed');
  const [settingsFieldIndex, setSettingsFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [controlsSelectedIndex, setControlsSelectedIndex] = useState(0);
  const [controlsRebindActionId, setControlsRebindActionId] = useState<
    string | null
  >(null);

  const setSettingsOpen = useCallback((open: boolean) => {
    setSettingsMode(open ? 'settings' : 'closed');
  }, []);

  const setControlsOpen = useCallback((open: boolean) => {
    setSettingsMode(open ? 'controls' : 'settings');
  }, []);

  return {
    settingsMode,
    settingsOpen: settingsMode !== 'closed',
    controlsOpen: settingsMode === 'controls',
    setSettingsOpen,
    setControlsOpen,
    settingsFieldIndex,
    setSettingsFieldIndex,
    editingField,
    setEditingField,
    editBuffer,
    setEditBuffer,
    controlsSelectedIndex,
    setControlsSelectedIndex,
    controlsRebindActionId,
    setControlsRebindActionId,
  };
}
