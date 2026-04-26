import { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Alert, ConfirmInput } from '@inkjs/ui';
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
import type { DeleteConfirmMode } from '../hooks/useDeleteConfirmation.js';

interface DeleteConfirmModalProps {
  branch: string;
  reason: string;
  mode: DeleteConfirmMode;
  confirmInput: string;
}

const CURSOR_BLINK_MS = 500;

// Solid background for the dialog so the underlying sidebar/diff text
// can't bleed through padding cells. Ink only paints cells that have
// explicit content or backgroundColor — without this, blank padding
// inside the Pane is transparent.
const MODAL_BG = 'black';

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

// Delete confirmation dialog. Two modes:
//   - 'type-branch': high-friction confirm for branches with
//     uncommitted/unpushed work. User must type the branch name.
//   - 'yes-no': lightweight Y/N for git-clean branches whose only
//     loss-on-delete is the running agent's in-memory context.
// Each mode owns its own keypress routing — 'type-branch' via the
// local useInput hook, 'yes-no' via @inkjs/ui's ConfirmInput.
export function DeleteConfirmModal({
  branch,
  reason,
  mode,
  confirmInput,
}: DeleteConfirmModalProps) {
  return mode === 'yes-no' ? (
    <YesNoModal branch={branch} reason={reason} />
  ) : (
    <TypeBranchModal
      branch={branch}
      reason={reason}
      confirmInput={confirmInput}
    />
  );
}

function TypeBranchModal({
  branch,
  reason,
  confirmInput,
}: {
  branch: string;
  reason: string;
  confirmInput: string;
}) {
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
      <Pane
        focused
        title="Confirm Delete"
        flexDirection="column"
        backgroundColor={MODAL_BG}
      >
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

function YesNoModal({ branch, reason }: { branch: string; reason: string }) {
  const deleteConfirmState = useDeleteConfirmState();
  const deleteConfirmActions = useDeleteConfirmActions();
  const sessions = useSessionActions();
  const asyncOps = useAsyncOps();

  const performDelete = () => {
    // Capture sessionName before clearing modal state — the async
    // runs after setConfirmDelete(null) clears it.
    const sessionName = deleteConfirmState.confirmDelete?.sessionName;
    if (sessionName) {
      asyncOps.run('delete', async () => {
        await sessions.performDelete(sessionName, branch);
        sessions.flashStatus(`Deleted ${branch}`);
      });
    }
    deleteConfirmActions.setConfirmDelete(null);
    deleteConfirmActions.setConfirmInput('');
  };

  const cancel = () => {
    deleteConfirmActions.setConfirmDelete(null);
    deleteConfirmActions.setConfirmInput('');
  };

  // ConfirmInput handles y / n / Enter. Add Esc as a cancel for parity
  // with the type-branch modal — users expect Esc to dismiss any modal.
  useInput((_input, key) => {
    if (key.escape) cancel();
  });

  return (
    <Modal>
      <Pane
        focused
        title="Confirm Delete"
        flexDirection="column"
        backgroundColor={MODAL_BG}
      >
        <Box flexDirection="column" padding={1} gap={1}>
          <Alert variant="warning">{reason}</Alert>
          <Text>
            Delete{' '}
            <Text bold color="yellow">
              {branch}
            </Text>
            ?{' '}
            <ConfirmInput
              defaultChoice="cancel"
              onConfirm={performDelete}
              onCancel={cancel}
            />
          </Text>
          <Text dimColor>Y to confirm · N / Enter / Esc to cancel</Text>
        </Box>
      </Pane>
    </Modal>
  );
}
