import { useState } from 'react';

export function useSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFieldIndex, setSettingsFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [controlsSelectedIndex, setControlsSelectedIndex] = useState(0);
  const [controlsRebindActionId, setControlsRebindActionId] = useState<
    string | null
  >(null);

  return {
    settingsOpen,
    setSettingsOpen,
    settingsFieldIndex,
    setSettingsFieldIndex,
    editingField,
    setEditingField,
    editBuffer,
    setEditBuffer,
    controlsOpen,
    setControlsOpen,
    controlsSelectedIndex,
    setControlsSelectedIndex,
    controlsRebindActionId,
    setControlsRebindActionId,
  };
}
