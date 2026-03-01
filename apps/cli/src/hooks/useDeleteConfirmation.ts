import { useState } from 'react';

export interface DeleteConfirmState {
  branch: string;
  sessionName: string;
  reason: string;
}

export function useDeleteConfirmation() {
  const [confirmDelete, setConfirmDelete] = useState<DeleteConfirmState | null>(
    null
  );
  const [confirmInput, setConfirmInput] = useState('');

  return {
    confirmDelete,
    setConfirmDelete,
    confirmInput,
    setConfirmInput,
  };
}
