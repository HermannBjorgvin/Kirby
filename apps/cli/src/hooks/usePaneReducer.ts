import { useReducer, useMemo, useState } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { PaneMode, SidebarItem } from '../types.js';
import { getPrFromItem } from '../types.js';
import { hasSession } from '../pty-registry.js';

// ── State ────────────────────────────────────────────────────────

export interface PaneState {
  // Pane mode
  paneMode: PaneMode;
  reconnectKey: number;
  reviewSessionStarted: Set<number>;

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

const initialState: PaneState = {
  paneMode: 'terminal',
  reconnectKey: 0,
  reviewSessionStarted: new Set(),
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

type PaneAction =
  | { type: 'SET_PANE_MODE'; mode: PaneMode }
  | { type: 'SET_RECONNECT_KEY'; updater: Updater<number> }
  | { type: 'SET_REVIEW_SESSION_STARTED'; updater: Updater<Set<number>> }
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

function paneReducer(state: PaneState, action: PaneAction): PaneState {
  switch (action.type) {
    case 'SET_PANE_MODE':
      return { ...state, paneMode: action.mode };
    case 'SET_RECONNECT_KEY':
      return { ...state, reconnectKey: resolve(action.updater, state.reconnectKey) };
    case 'SET_REVIEW_SESSION_STARTED':
      return { ...state, reviewSessionStarted: resolve(action.updater, state.reviewSessionStarted) };
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
export type PaneModeValue = PaneState & PaneActions;

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
 * Auto-resets pane mode when the selected sidebar item changes.
 */
export function usePaneReducer(
  selectedItem: SidebarItem | undefined,
  sessionNameForTerminal: string | null
): PaneModeValue {
  const [state, dispatch] = useReducer(paneReducer, initialState);

  // Auto-reset pane mode when selected item changes.
  // Uses the React "store previous value" pattern.
  const itemKey = selectedItem
    ? selectedItem.kind === 'session'
      ? `session:${selectedItem.session.name}`
      : `pr:${selectedItem.pr.id}`
    : null;

  const [prevItemKey, setPrevItemKey] = useState<string | null>(null);
  if (itemKey !== prevItemKey) {
    setPrevItemKey(itemKey);
    const target = defaultPaneMode(
      selectedItem,
      sessionNameForTerminal,
      state.reviewSessionStarted
    );
    if (target !== state.paneMode) {
      dispatch({ type: 'SET_PANE_MODE', mode: target });
    }
  }

  const actions = useMemo<PaneActions>(
    () => ({
      setPaneMode: (mode) => dispatch({ type: 'SET_PANE_MODE', mode }),
      setReconnectKey: (updater) =>
        dispatch({ type: 'SET_RECONNECT_KEY', updater }),
      setReviewSessionStarted: (updater) =>
        dispatch({ type: 'SET_REVIEW_SESSION_STARTED', updater }),
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
    () => ({ ...state, ...actions }),
    [state, actions]
  );
}
