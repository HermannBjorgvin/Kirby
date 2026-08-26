// ── Input primitives ─────────────────────────────────────────────
export type { KeyPress } from './lib/input/key-press.js';
export { handleTextInput } from './lib/input/handle-text-input.js';

// ── Keybindings ──────────────────────────────────────────────────
export * from './lib/keybindings/index.js';

// ── Settings field model ─────────────────────────────────────────
export {
  AI_PRESETS,
  BOOL_PRESETS,
  BOOL_PRESETS_ON_FIRST,
  EDITOR_PRESETS,
  SYNC_INTERVAL_PRESETS,
  KEYBIND_PRESETS,
  buildSettingsFields,
  resolveValue,
} from './lib/settings/fields.js';
export type { SettingsField } from './lib/settings/fields.js';

// ── Domain types ─────────────────────────────────────────────────
export * from './lib/types.js';
export * from './lib/activity-config.js';
export * from './lib/plan/plan-types.js';

// ── Session / PTY infrastructure (Node host side) ────────────────
export * from './lib/session-backend.js';
export * from './lib/pty-registry.js';
export {
  attach,
  detach,
  noteInput,
  noteResize,
  noteSeen,
  snapshot,
  __resetForTests as __resetActivityForTests,
} from './lib/activity.js';
export type { ActivitySnapshot } from './lib/activity.js';
export {
  enqueue,
  dequeueOldest,
  remove,
  peekAll,
  size,
  subscribe,
} from './lib/inactive-alerts.js';
export * from './lib/agents/registry.js';
export * from './lib/session/launch-session.js';
export * from './lib/session/review-prompt.js';
export * from './lib/session/checkout-plan.js';

// ── Pure utilities ───────────────────────────────────────────────
export * from './lib/utils/sidebar-items.js';
export * from './lib/utils/session-sort.js';
export * from './lib/utils/running-tabs.js';
export * from './lib/utils/scroll-window.js';
export * from './lib/utils/truncate.js';
export * from './lib/utils/virtual-viewport.js';
export * from './lib/utils/pr-utils.js';
export * from './lib/utils/diff-fetcher.js';
export * from './lib/utils/language.js';
export * from './lib/utils/resolve-preset-name.js';

// ── Plan store ───────────────────────────────────────────────────
// `remove` is aliased because inactive-alerts' unary `remove(name)`
// (re-exported above) would otherwise shadow plan-store's ternary
// `remove(prId, kind, id)` in the barrel namespace.
export {
  add,
  count,
  has,
  list,
  clear,
  toggle,
  annotate,
  usePlanStore,
} from './lib/plan/plan-store.js';
export {
  remove as removePlanItem,
  __resetPlanStoreForTest,
} from './lib/plan/plan-store.js';
export * from './lib/plan/prompt-composer.js';

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
export * from './lib/sync/remote-sync.js';
export * from './lib/hooks/usePrData.js';
export * from './lib/hooks/usePtySession.js';
export * from './lib/hooks/useRemoteComments.js';
export * from './lib/hooks/useRemoteSync.js';
export * from './lib/hooks/useReviewComments.js';
export * from './lib/hooks/useRunningTabs.js';
export * from './lib/hooks/useSessionManager.js';
export * from './lib/hooks/useSettings.js';
export * from './lib/hooks/useTerminalDimensions.js';
