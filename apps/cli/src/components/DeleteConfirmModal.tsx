import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Alert } from '@inkjs/ui';
import { Modal } from './Modal.js';
import { Pane } from './Pane.js';
import {
  useDeleteConfirmState,
  useDeleteConfirmActions,
} from '../context/ModalContext.js';
import { useSessionActions } from '../context/SessionContext.js';
import { useAsyncOps } from '../context/AsyncOpsContext.js';
import { useKeybindResolve } from '../context/KeybindContext.js';
import { handleConfirmDeleteInput } from '../screens/main/confirm-delete-input.js';

interface DeleteConfirmModalProps {
  branch: string;
  reason: string;
  confirmInput: string;
}

const CURSOR_BLINK_MS = 500;

// Simple blinking-underscore cursor for the confirm input. Reads more
// alive than a static "_". Toggled via setInterval; cleared on unmount.
function BlinkingCursor() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), CURSOR_BLINK_MS);
    return () => clearInterval(id);
  }, []);
  return <Text dimColor>{visible ? '_' : ' '}</Text>;
}

// Delete confirmation dialog. Shown when the user triggers a session
// delete. Owns its own keypress routing via a nested useInput hook;
// MainTab no longer has to branch on deleteConfirm.confirmDelete.
export function DeleteConfirmModal({
  branch,
  reason,
  confirmInput,
}: DeleteConfirmModalProps) {
  const deleteConfirmState = useDeleteConfirmState();
  const deleteConfirmActions = useDeleteConfirmActions();
  const deleteConfirm = useMemo(
    () => ({ ...deleteConfirmState, ...deleteConfirmActions }),
    [deleteConfirmState, deleteConfirmActions]
  );
  const sessions = useSessionActions();
  const asyncOps = useAsyncOps();
  const keybinds = useKeybindResolve();

  useInput(
    (input, key) => {
      handleConfirmDeleteInput(input, key, {
        deleteConfirm,
        sessions,
        asyncOps,
        keybinds,
      });
    },
    { isActive: deleteConfirm.confirmDelete !== null }
  );

  return (
    <Modal>
      <Pane focused title="Confirm Delete" flexDirection="column">
        <Box flexDirection="column" padding={1} gap={1}>
          <Alert variant="warning">{reason}</Alert>
          <Text>
            Type{' '}
            <Text bold color="yellow">
              {branch}
            </Text>{' '}
            to confirm:
          </Text>
          <Text>
            <Text color="cyan">{confirmInput}</Text>
            <BlinkingCursor />
          </Text>
          <Text dimColor>Esc to cancel</Text>
        </Box>
      </Pane>
    </Modal>
  );
}
