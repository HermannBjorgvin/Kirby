import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Alert } from '@inkjs/ui';
import { Modal } from './Modal.js';
import { Pane } from './Pane.js';

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
// delete. Input handling lives in handleConfirmDeleteInput (see
// main-input.ts) — this component is purely visual.
export function DeleteConfirmModal({
  branch,
  reason,
  confirmInput,
}: DeleteConfirmModalProps) {
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
