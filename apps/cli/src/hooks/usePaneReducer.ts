import { useMemo, useReducer } from 'react';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { PaneMode, SidebarItem } from '../types.js';
import { getPrFromItem } from '../types.js';
import { hasSession } from '../pty-registry.js';

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

  // Remote comment reply
  replyingToThreadId: string | null;
  replyBuffer: string;

  // General comments pane
  generalCommentsIndex: number;
  generalCommentsScrollOffset: number;

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
  replyingToThreadId: null,
  replyBuffer: '',
  generalCommentsIndex: 0,
  generalCommentsScrollOffset: 0,
  reviewConfirm: null,
  reviewInstruction: '',
};

// ── Actions ──────────────────────────────────────────────────────

type Updater<T> = T | ((prev: T) => T);
function resolve<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function'
    ? (updater as (prev: T) => T)(prev)
    : updater;
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
  | { type: 'SET_REPLYING_TO_THREAD_ID'; id: string | null }
  | { type: 'SET_REPLY_BUFFER'; updater: Updater<string> }
  | { type: 'SET_GENERAL_COMMENTS_INDEX'; updater: Updater<number> }
  | { type: 'SET_GENERAL_COMMENTS_SCROLL_OFFSET'; updater: Updater<number> }
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
      return {
        ...state,
        reconnectKey: resolve(action.updater, state.reconnectKey),
      };
    case 'SET_DIFF_FILE_INDEX':
      return {
        ...state,
        diffFileIndex: resolve(action.updater, state.diffFileIndex),
      };
    case 'SET_DIFF_VIEW_FILE':
      return { ...state, diffViewFile: action.file };
    case 'SET_DIFF_SCROLL_OFFSET':
      return {
        ...state,
        diffScrollOffset: resolve(action.updater, state.diffScrollOffset),
      };
    case 'SET_SHOW_SKIPPED':
      return {
        ...state,
        showSkipped: resolve(action.updater, state.showSkipped),
      };
    case 'SET_SELECTED_COMMENT_ID':
      return { ...state, selectedCommentId: action.id };
    case 'SET_PENDING_DELETE_COMMENT_ID':
      return { ...state, pendingDeleteCommentId: action.id };
    case 'SET_EDITING_COMMENT_ID':
      return { ...state, editingCommentId: action.id };
    case 'SET_EDIT_BUFFER':
      return {
        ...state,
        editBuffer: resolve(action.updater, state.editBuffer),
      };
    case 'SET_REPLYING_TO_THREAD_ID':
      return { ...state, replyingToThreadId: action.id };
    case 'SET_REPLY_BUFFER':
      return {
        ...state,
        replyBuffer: resolve(action.updater, state.replyBuffer),
      };
    case 'SET_GENERAL_COMMENTS_INDEX':
      return {
        ...state,
        generalCommentsIndex: resolve(
          action.updater,
          state.generalCommentsIndex
        ),
      };
    case 'SET_GENERAL_COMMENTS_SCROLL_OFFSET':
      return {
        ...state,
        generalCommentsScrollOffset: resolve(
          action.updater,
          state.generalCommentsScrollOffset
        ),
      };
    case 'SET_REVIEW_CONFIRM':
      return { ...state, reviewConfirm: action.value };
    case 'SET_REVIEW_INSTRUCTION':
      return {
        ...state,
        reviewInstruction: resolve(action.updater, state.reviewInstruction),
      };
  }
}

// ── Actions wrapper (preserves same setter API for input handlers) ──

export interface PaneActions {
  setPaneMode: (mode: PaneMode) => void;
  setReconnectKey: (updater: Updater<number>) => void;
  setDiffFileIndex: (updater: Updater<number>) => void;
  setDiffViewFile: (file: string | null) => void;
  setDiffScrollOffset: (updater: Updater<number>) => void;
  setShowSkipped: (updater: Updater<boolean>) => void;
  setSelectedCommentId: (id: string | null) => void;
  setPendingDeleteCommentId: (id: string | null) => void;
  setEditingCommentId: (id: string | null) => void;
  setEditBuffer: (updater: Updater<string>) => void;
  setReplyingToThreadId: (id: string | null) => void;
  setReplyBuffer: (updater: Updater<string>) => void;
  setGeneralCommentsIndex: (updater: Updater<number>) => void;
  setGeneralCommentsScrollOffset: (updater: Updater<number>) => void;
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
  sessionName: string | null
): PaneMode {
  if (!item) return 'terminal';
  if (sessionName && hasSession(sessionName)) return 'terminal';
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
 * Pane state no longer tracks "has this review-PR been started" — the
 * spawned `claude --continue || claude` handles resume-if-possible at
 * the shell level, which makes a JS-side cache redundant. Returning to
 * a review-PR row whose PTY has exited shows pr-detail; pressing Enter
 * re-enters via claude --continue.
 */
export function usePaneReducer(
  selectedItem: SidebarItem | undefined,
  sessionNameForTerminal: string | null
): PaneModeValue {
  const [state, dispatch] = useReducer(
    paneReducer,
    { selectedItem, sessionNameForTerminal },
    (arg) => ({
      ...initialState,
      paneMode: defaultPaneMode(arg.selectedItem, arg.sessionNameForTerminal),
    })
  );

  const actions = useMemo<PaneActions>(
    () => ({
      setPaneMode: (mode) => dispatch({ type: 'SET_PANE_MODE', mode }),
      setReconnectKey: (updater) =>
        dispatch({ type: 'SET_RECONNECT_KEY', updater }),
      setDiffFileIndex: (updater) =>
        dispatch({ type: 'SET_DIFF_FILE_INDEX', updater }),
      setDiffViewFile: (file) => dispatch({ type: 'SET_DIFF_VIEW_FILE', file }),
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
      setReplyingToThreadId: (id) =>
        dispatch({ type: 'SET_REPLYING_TO_THREAD_ID', id }),
      setReplyBuffer: (updater) =>
        dispatch({ type: 'SET_REPLY_BUFFER', updater }),
      setGeneralCommentsIndex: (updater) =>
        dispatch({ type: 'SET_GENERAL_COMMENTS_INDEX', updater }),
      setGeneralCommentsScrollOffset: (updater) =>
        dispatch({ type: 'SET_GENERAL_COMMENTS_SCROLL_OFFSET', updater }),
      setReviewConfirm: (value) =>
        dispatch({ type: 'SET_REVIEW_CONFIRM', value }),
      setReviewInstruction: (updater) =>
        dispatch({ type: 'SET_REVIEW_INSTRUCTION', updater }),
    }),
    []
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
