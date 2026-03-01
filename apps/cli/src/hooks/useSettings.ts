import { useState } from 'react';

export function useSettings() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFieldIndex, setSettingsFieldIndex] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editBuffer, setEditBuffer] = useState('');

  return {
    settingsOpen,
    setSettingsOpen,
    settingsFieldIndex,
    setSettingsFieldIndex,
    editingField,
    setEditingField,
    editBuffer,
    setEditBuffer,
  };
}
