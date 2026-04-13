import { Text } from 'ink';
import { Alert, Spinner } from '@inkjs/ui';
import { useAppState } from '../context/AppStateContext.js';
import { useSessionData } from '../context/SessionContext.js';
import { useConfig } from '../context/ConfigContext.js';

// Slim bottom status bar — one row.
//
// Only shows persistent/ongoing state. Transient notifications (the old
// `statusMessage` flow) now render as toasts in the top-right — see
// ToastContainer + ToastContext. Delete confirm UI lives in
// DeleteConfirmModal. Branch picker filter lives in its own pane.
//
// Priority (highest first):
//   1. prError        → persistent, red, until next successful poll
//   2. terminal focus → dim hint
//   3. asyncOps       → live spinner
//   4. VCS setup hint → dim hint when not configured
export function StatusBar() {
  const { nav, asyncOps } = useAppState();
  const { prError } = useSessionData();
  const { vcsConfigured } = useConfig();

  if (prError) return <Alert variant="error">{`PR error: ${prError}`}</Alert>;
  if (nav.focus === 'terminal')
    return <Text dimColor>ctrl+space to exit terminal</Text>;

  if (asyncOps.inFlight.size > 0) {
    return <Spinner label={[...asyncOps.inFlight].join(', ')} />;
  }

  return !vcsConfigured ? <Text dimColor>(s to configure VCS)</Text> : null;
}
