import { useState } from 'react';

export type DeleteConfirmMode = 'type-branch' | 'yes-no';

export interface DeleteConfirmState {
  branch: string;
  sessionName: string;
  reason: string;
  // 'type-branch' = high friction (typing the branch name) for branches
  // with uncommitted/unpushed work that would be lost on disk.
  // 'yes-no' = low friction (Y/N) when only the in-memory agent session
  // is at stake — the branch itself is git-clean.
  mode: DeleteConfirmMode;
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
