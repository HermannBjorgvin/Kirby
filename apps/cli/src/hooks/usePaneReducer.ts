import { useMemo, useReducer, useSyncExternalStore } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { PaneMode, SidebarItem } from '../types.js';
import { getPrFromItem } from '../types.js';
import { hasSession } from '../pty-registry.js';

// ── reviewSessionStarted external store ──────────────────────────
//
// Tracks which review-PR sessions the user has explicitly started
// (i.e. after the "Start session" confirm). When the user navigates
// back to that review row, we want pane mode to land on 'terminal'
// instead of re-opening the PR-detail screen. This piece of state
// deliberately *persists across sidebar-item changes* — unlike the
// rest of PaneState, which resets on item change via the `key` remount
// of MainTabBody (see MainTab.tsx).
//
// Because the usePaneReducer call gets a fresh `useReducer` on every
// remount, we can't keep this set in `PaneState` — it'd blow away on
// every navigation. Hosting it in a module-local store means the set
// survives key remounts while useSyncExternalStore keeps consumers
// subscribed.

let reviewStartedSet = new Set<number>();
const reviewStartedListeners = new Set<() => void>();

function subscribeReviewStarted(cb: () => void): () => void {
  reviewStartedListeners.add(cb);
  return () => {
    reviewStartedListeners.delete(cb);
  };
}

function getReviewStartedSnapshot(): Set<number> {
  return reviewStartedSet;
}

function notifyReviewStarted(): void {
  for (const cb of reviewStartedListeners) cb();
}

/**
 * Imperative writer for the reviewSessionStarted store. Accepts the
 * same Updater<Set<number>> shape the old SET_REVIEW_SESSION_STARTED
 * action did, so callers (confirm-input.ts) don't need to change.
 */
function setReviewSessionStartedExternal(
  updater: Updater<Set<number>>
): void {
  reviewStartedSet = resolve(updater, reviewStartedSet);
  notifyReviewStarted();
}

/**
 * Test-only: reset the external store. Real code should never call
 * this — the store is deliberately persistent. Used by specs that
 * want a clean slate between runs.
 */
export function __resetReviewSessionStartedForTest(): void {
  reviewStartedSet = new Set();
  notifyReviewStarted();
}

// ── State ────────────────────────────────────────────────────────

export interface PaneState {
  // Pane mode
  paneMode: PaneMode;
  reconnectKey: number;

  // Diff navigation
  diffFileIndex: number;
  diffViewFile: string | null;
  diffScrollOffset: number;
  showSkipped: boolean;

  // Comment editing
  selectedCommentId: string | null;
  pendingDeleteCommentId: string | null;
  editingCommentId: string | null;
  editBuffer: string;

  // Review confirm
  reviewConfirm: { pr: PullRequestInfo; selectedOption: number } | null;
  reviewInstruction: string;
}

export const initialState: PaneState = {
  paneMode: 'terminal',
  reconnectKey: 0,
  diffFileIndex: 0,
  diffViewFile: null,
  diffScrollOffset: 0,
  showSkipped: false,
  selectedCommentId: null,
  pendingDeleteCommentId: null,
  editingCommentId: null,
  editBuffer: '',
  reviewConfirm: null,
  reviewInstruction: '',
};

// ── Actions ──────────────────────────────────────────────────────

type Updater<T> = T | ((prev: T) => T);
function resolve<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (prev: T) => T)(prev) : updater;
}

export type PaneAction =
  | { type: 'SET_PANE_MODE'; mode: PaneMode }
  | { type: 'SET_RECONNECT_KEY'; updater: Updater<number> }
  | { type: 'SET_DIFF_FILE_INDEX'; updater: Updater<number> }
  | { type: 'SET_DIFF_VIEW_FILE'; file: string | null }
  | { type: 'SET_DIFF_SCROLL_OFFSET'; updater: Updater<number> }
  | { type: 'SET_SHOW_SKIPPED'; updater: Updater<boolean> }
  | { type: 'SET_SELECTED_COMMENT_ID'; id: string | null }
  | { type: 'SET_PENDING_DELETE_COMMENT_ID'; id: string | null }
  | { type: 'SET_EDITING_COMMENT_ID'; id: string | null }
  | { type: 'SET_EDIT_BUFFER'; updater: Updater<string> }
  | {
      type: 'SET_REVIEW_CONFIRM';
      value: { pr: PullRequestInfo; selectedOption: number } | null;
    }
  | { type: 'SET_REVIEW_INSTRUCTION'; updater: Updater<string> };

export function paneReducer(state: PaneState, action: PaneAction): PaneState {
  switch (action.type) {
    case 'SET_PANE_MODE':
      return { ...state, paneMode: action.mode };
    case 'SET_RECONNECT_KEY':
      return { ...state, reconnectKey: resolve(action.updater, state.reconnectKey) };
    case 'SET_DIFF_FILE_INDEX':
      return { ...state, diffFileIndex: resolve(action.updater, state.diffFileIndex) };
    case 'SET_DIFF_VIEW_FILE':
      return { ...state, diffViewFile: action.file };
    case 'SET_DIFF_SCROLL_OFFSET':
      return { ...state, diffScrollOffset: resolve(action.updater, state.diffScrollOffset) };
    case 'SET_SHOW_SKIPPED':
      return { ...state, showSkipped: resolve(action.updater, state.showSkipped) };
    case 'SET_SELECTED_COMMENT_ID':
      return { ...state, selectedCommentId: action.id };
    case 'SET_PENDING_DELETE_COMMENT_ID':
      return { ...state, pendingDeleteCommentId: action.id };
    case 'SET_EDITING_COMMENT_ID':
      return { ...state, editingCommentId: action.id };
    case 'SET_EDIT_BUFFER':
      return { ...state, editBuffer: resolve(action.updater, state.editBuffer) };
    case 'SET_REVIEW_CONFIRM':
      return { ...state, reviewConfirm: action.value };
    case 'SET_REVIEW_INSTRUCTION':
      return { ...state, reviewInstruction: resolve(action.updater, state.reviewInstruction) };
  }
}

// ── Actions wrapper (preserves same setter API for input handlers) ──

export interface PaneActions {
  setPaneMode: (mode: PaneMode) => void;
  setReconnectKey: (updater: Updater<number>) => void;
  setReviewSessionStarted: (updater: Updater<Set<number>>) => void;
  setDiffFileIndex: (updater: Updater<number>) => void;
  setDiffViewFile: (file: string | null) => void;
  setDiffScrollOffset: (updater: Updater<number>) => void;
  setShowSkipped: (updater: Updater<boolean>) => void;
  setSelectedCommentId: (id: string | null) => void;
  setPendingDeleteCommentId: (id: string | null) => void;
  setEditingCommentId: (id: string | null) => void;
  setEditBuffer: (updater: Updater<string>) => void;
  setReviewConfirm: (
    value: { pr: PullRequestInfo; selectedOption: number } | null
  ) => void;
  setReviewInstruction: (updater: Updater<string>) => void;
}

/** Combined type for input handlers: read state + call setters. */
export type PaneModeValue = PaneState & {
  /** Which review PRs have an active session started. Survives
   * navigation (lives in an external store, not in the reducer). */
  reviewSessionStarted: Set<number>;
} & PaneActions;

// ── Hook ─────────────────────────────────────────────────────────

function defaultPaneMode(
  item: SidebarItem | undefined,
  sessionName: string | null,
  reviewSessionStarted: Set<number>
): PaneMode {
  if (!item) return 'terminal';
  if (sessionName && hasSession(sessionName)) return 'terminal';
  if (item.kind === 'review-pr' && reviewSessionStarted.has(item.pr.id)) {
    return 'terminal';
  }
  const pr = getPrFromItem(item);
  if (pr) return 'pr-detail';
  return 'terminal';
}

/**
 * Consolidated pane state machine. Replaces the previous four hooks:
 * usePaneMode, useDiffState, useCommentState, useReviewConfirmState.
 *
 * The call site (MainTab) mounts this hook inside a component keyed on
 * the selected sidebar item's identity, so on every item change the
 * hook remounts and `useReducer`'s lazy initializer picks the starting
 * pane mode via `defaultPaneMode`. There is no render-time auto-reset
 * path anymore.
 *
 * `reviewSessionStarted` is the only piece of state that deliberately
 * persists across item changes; it lives in a module-local external
 * store and is read via `useSyncExternalStore`.
 */
export function usePaneReducer(
  selectedItem: SidebarItem | undefined,
  sessionNameForTerminal: string | null
): PaneModeValue {
  const reviewSessionStarted = useSyncExternalStore(
    subscribeReviewStarted,
    getReviewStartedSnapshot
  );

  const [state, dispatch] = useReducer(
    paneReducer,
    { selectedItem, sessionNameForTerminal, reviewSessionStarted },
    (arg) => ({
      ...initialState,
      paneMode: defaultPaneMode(
        arg.selectedItem,
        arg.sessionNameForTerminal,
        arg.reviewSessionStarted
      ),
    })
  );

  const actions = useMemo<PaneActions>(
    () => ({
      setPaneMode: (mode) => dispatch({ type: 'SET_PANE_MODE', mode }),
      setReconnectKey: (updater) =>
        dispatch({ type: 'SET_RECONNECT_KEY', updater }),
      setReviewSessionStarted: setReviewSessionStartedExternal,
      setDiffFileIndex: (updater) =>
        dispatch({ type: 'SET_DIFF_FILE_INDEX', updater }),
      setDiffViewFile: (file) =>
        dispatch({ type: 'SET_DIFF_VIEW_FILE', file }),
      setDiffScrollOffset: (updater) =>
        dispatch({ type: 'SET_DIFF_SCROLL_OFFSET', updater }),
      setShowSkipped: (updater) =>
        dispatch({ type: 'SET_SHOW_SKIPPED', updater }),
      setSelectedCommentId: (id) =>
        dispatch({ type: 'SET_SELECTED_COMMENT_ID', id }),
      setPendingDeleteCommentId: (id) =>
        dispatch({ type: 'SET_PENDING_DELETE_COMMENT_ID', id }),
      setEditingCommentId: (id) =>
        dispatch({ type: 'SET_EDITING_COMMENT_ID', id }),
      setEditBuffer: (updater) =>
        dispatch({ type: 'SET_EDIT_BUFFER', updater }),
      setReviewConfirm: (value) =>
        dispatch({ type: 'SET_REVIEW_CONFIRM', value }),
      setReviewInstruction: (updater) =>
        dispatch({ type: 'SET_REVIEW_INSTRUCTION', updater }),
    }),
    []
  );

  return useMemo(
    () => ({ ...state, reviewSessionStarted, ...actions }),
    [state, reviewSessionStarted, actions]
  );
}
