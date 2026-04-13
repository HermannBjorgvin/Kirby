import { Text } from 'ink';
import { useConfig } from '../context/ConfigContext.js';

// Bottom bar. After M7 this is the quietest surface in the app —
// everything transient moved elsewhere:
//
//   - PR fetch errors              → toast (SessionContext useEffect)
//   - statusMessage (transient)    → toast (flashStatus → ToastContext)
//   - asyncOps.inFlight spinner    → AsyncOpsIndicator overlay (top-right)
//   - ctrl+space-to-exit hint      → pane title (getPaneTitle)
//   - delete confirmation          → DeleteConfirmModal
//   - branch picker filter echo    → BranchPicker pane itself
//
// Only the VCS setup hint remains here. Renders null once VCS is
// configured, so the bottom row is completely empty in the steady
// state. If we never find another use for this strip, a follow-up can
// delete StatusBar entirely and surface the hint as an onboarding toast.
export function StatusBar() {
  const { vcsConfigured } = useConfig();
  if (vcsConfigured) return null;
  return <Text dimColor>(s to configure VCS)</Text>;
}
