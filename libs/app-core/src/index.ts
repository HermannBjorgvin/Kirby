// @kirby/app-core — the React layer shared by Kirby's shells.
//
// Contexts, hooks and headless screen controllers. Everything here
// needs React; anything that does not belongs in @kirby/core, which
// this package depends on and which never depends back.
//
// Consumers import backend primitives from @kirby/core directly — this
// barrel deliberately does not re-export them, so the layer a symbol
// comes from is visible at every call site.

// ── Plan store (React binding) ───────────────────────────────────
export { usePlanStore } from './lib/plan/use-plan-store.js';

// ── Headless screen controllers ─────────────────────────────────
export * from './lib/controllers/diff-file-list.js';
export * from './lib/controllers/diff-file-viewer.js';

// ── React contexts ───────────────────────────────────────────────
export * from './lib/context/ConfigContext.js';
export * from './lib/context/KeybindContext.js';
export * from './lib/context/LayoutContext.js';
export * from './lib/context/NavContext.js';
export * from './lib/context/AsyncOpsContext.js';
export * from './lib/context/PlanContext.js';
export * from './lib/context/ModalContext.js';
export * from './lib/context/SessionContext.js';
export * from './lib/context/SidebarContext.js';
export * from './lib/context/ToastContext.js';

// ── Hooks ────────────────────────────────────────────────────────
export * from './lib/hooks/useActivity.js';
export * from './lib/hooks/useAsyncOperation.js';
export * from './lib/hooks/useAutoSelectFirstComment.js';
export * from './lib/hooks/useBranchPicker.js';
export * from './lib/hooks/useConflictCounts.js';
export * from './lib/hooks/useDeleteConfirmation.js';
export * from './lib/hooks/useDiffBundle.js';
export * from './lib/hooks/useDiffData.js';
export * from './lib/hooks/useInactiveAlertWatcher.js';
export * from './lib/hooks/useMergedBranches.js';
export * from './lib/hooks/useNavigation.js';
export * from './lib/hooks/usePaneReducer.js';
export * from './lib/hooks/usePendingThreadScrollIntoView.js';
export * from './lib/hooks/usePolling.js';
export * from './lib/hooks/usePrData.js';
export * from './lib/hooks/usePtySession.js';
export * from './lib/hooks/useRemoteComments.js';
export * from './lib/hooks/useRemoteSync.js';
export * from './lib/hooks/useReviewComments.js';
export * from './lib/hooks/useRunningTabs.js';
export * from './lib/hooks/useSessionManager.js';
export * from './lib/hooks/useSettings.js';
export * from './lib/hooks/useTerminalDimensions.js';
