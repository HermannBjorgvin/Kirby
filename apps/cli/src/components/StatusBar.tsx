import { Text } from 'ink';
import { useAppState } from '../context/AppStateContext.js';
import {
  useSessionActions,
  useSessionData,
} from '../context/SessionContext.js';
import { useConfig } from '../context/ConfigContext.js';

export function StatusBar() {
  const { branchPicker, deleteConfirm, asyncOps } = useAppState();
  const { statusMessage } = useSessionActions();
  const { prError } = useSessionData();
  const { vcsConfigured } = useConfig();

  if (deleteConfirm.confirmDelete) {
    return (
      <Text>
        <Text color="red">
          Warning: {deleteConfirm.confirmDelete.reason}. Type{' '}
        </Text>
        <Text bold color="yellow">
          {deleteConfirm.confirmDelete.branch}
        </Text>
        <Text color="red"> to confirm: </Text>
        <Text color="cyan">{deleteConfirm.confirmInput}</Text>
        <Text dimColor>_</Text>
        <Text dimColor> · Esc cancel</Text>
      </Text>
    );
  }
  if (branchPicker.creating) {
    return (
      <Text>
        Branch: <Text color="cyan">{branchPicker.branchFilter}</Text>
        <Text dimColor>_</Text>
        <Text dimColor> · Enter select · Esc cancel</Text>
      </Text>
    );
  }
  if (statusMessage) {
    return <Text color="yellow">{statusMessage}</Text>;
  }
  if (prError) {
    return <Text color="red">PR error: {prError}</Text>;
  }

  const ops =
    asyncOps.inFlight.size > 0
      ? ` · ${[...asyncOps.inFlight].join(', ')}...`
      : '';

  return (
    <Text dimColor>
      {!vcsConfigured ? ' · (s to configure VCS)' : ''}
      {ops ? <Text color="yellow">{ops}</Text> : null}
    </Text>
  );
}
