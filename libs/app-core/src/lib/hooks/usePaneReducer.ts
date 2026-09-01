import { useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import type { PaneMode, SessionMenuState, SidebarItem } from '@kirby/core';
import {
  consumeSessionMenuRequest,
  getPrFromItem,
  hasSession,
  openSessionMenuState,
  peekSessionMenuRequest,
  subscribeSessionMenuRequest,
} from '@kirby/core';

// ── State ────────────────────────────────────────────────────────

export interface PaneState {
  // Pane mode
  paneMode: PaneMode;
  reconnectKey: number;

  // Diff navigation
  diffFileIndex: number;
  diffViewFile: string | null;
  diffScrollOffset: number;
  // Top row of the diff-file-list unified viewport (file rows +
  // comment cards in one stream). Stepped row-wise by j/k so cards
  // taller than the viewport scroll into view before selection moves
  // past them.
  diffListScrollRow: number;
  showSkipped: boolean;

  // Comment editing
  selectedCommentId: string | null;
  pendingDeleteCommentId: string | null;
  editingCommentId: string | null;
  editBuffer: string;

  // Remote comment reply
  replyingToThreadId: string | null;
  replyBuffer: string;

  // After a reply posts successfully on this thread id, the
  // diff-viewer container scrolls the thread's bottom into view (the
  // new reply lives at the bottom of the card). Set by the
  // reply-mode success handler; cleared by the effect that performs
  // the scroll once the row map reflects the post-reply layout.
  pendingScrollThreadId: string | null;

  // General comments pane
  generalCommentsIndex: number;
  generalCommentsScrollOffset: number;

  // Session menu (start/continue with an agent, or start a review)
  sessionMenu: SessionMenuState | null;
  reviewInstruction: string;

  // Plan checkout ("add-to-cart")
  // Where Esc returns from the checkout pane.
  priorPaneMode: PaneMode;
  // Selected row in the checkout checklist.
  planCheckoutIndex: number;
  // planItemKey of the item whose annotation is being edited (in the
  // diff viewer Shift+A composer or the checkout pane), or null.
  annotatingPlanKey: string | null;
  annotationBuffer: string;
  // In State A (running agent) the checkout pane asks inject vs restart.
  planCheckoutTarget: 'inject' | 'new-session' | null;
}

export const initialState: PaneState = {
  paneMode: 'terminal',
  reconnectKey: 0,
  diffFileIndex: 0,
  diffViewFile: null,
  diffScrollOffset: 0,
  diffListScrollRow: 0,
  showSkipped: false,
  selectedCommentId: null,
  pendingDeleteCommentId: null,
  editingCommentId: null,
  editBuffer: '',
  replyingToThreadId: null,
  replyBuffer: '',
  pendingScrollThreadId: null,
  generalCommentsIndex: 0,
  generalCommentsScrollOffset: 0,
  sessionMenu: null,
  reviewInstruction: '',
  priorPaneMode: 'terminal',
  planCheckoutIndex: 0,
  annotatingPlanKey: null,
  annotationBuffer: '',
  planCheckoutTarget: null,
};

// ── Actions ──────────────────────────────────────────────────────

type Updater<T> = T | ((prev: T) => T);
function resolve<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function'
    ? (updater as (prev: T) => T)(prev)
    : updater;
}

/**
 * Every action sets exactly one field of PaneState, and the only thing that
 * varies between them is which of two payload shapes it carries: the new
 * value outright, or an updater applied to that field's previous value.
 *
 * So the action type *is* a field name, and these two tables are the whole
 * reducer. The action union below is derived from them rather than restated
 * beside them — which is what keeps a new pane field from having to be
 * spelled out in five places that can drift apart.
 */
const VALUE_FIELDS = {
  SET_PANE_MODE: 'paneMode',
  SET_DIFF_VIEW_FILE: 'diffViewFile',
  SET_SELECTED_COMMENT_ID: 'selectedCommentId',
  SET_PENDING_DELETE_COMMENT_ID: 'pendingDeleteCommentId',
  SET_EDITING_COMMENT_ID: 'editingCommentId',
  SET_REPLYING_TO_THREAD_ID: 'replyingToThreadId',
  SET_PENDING_SCROLL_THREAD_ID: 'pendingScrollThreadId',
  SET_PRIOR_PANE_MODE: 'priorPaneMode',
  SET_ANNOTATING_PLAN_KEY: 'annotatingPlanKey',
  SET_PLAN_CHECKOUT_TARGET: 'planCheckoutTarget',
} as const satisfies Record<string, keyof PaneState>;

const UPDATER_FIELDS = {
  SET_RECONNECT_KEY: 'reconnectKey',
  SET_DIFF_FILE_INDEX: 'diffFileIndex',
  SET_DIFF_SCROLL_OFFSET: 'diffScrollOffset',
  SET_DIFF_LIST_SCROLL_ROW: 'diffListScrollRow',
  SET_SHOW_SKIPPED: 'showSkipped',
  SET_EDIT_BUFFER: 'editBuffer',
  SET_REPLY_BUFFER: 'replyBuffer',
  SET_GENERAL_COMMENTS_INDEX: 'generalCommentsIndex',
  SET_GENERAL_COMMENTS_SCROLL_OFFSET: 'generalCommentsScrollOffset',
  SET_REVIEW_INSTRUCTION: 'reviewInstruction',
  SET_SESSION_MENU: 'sessionMenu',
  SET_PLAN_CHECKOUT_INDEX: 'planCheckoutIndex',
  SET_ANNOTATION_BUFFER: 'annotationBuffer',
} as const satisfies Record<string, keyof PaneState>;

type ValueAction = {
  [K in keyof typeof VALUE_FIELDS]: {
    type: K;
    value: PaneState[(typeof VALUE_FIELDS)[K]];
  };
}[keyof typeof VALUE_FIELDS];

type UpdaterAction = {
  [K in keyof typeof UPDATER_FIELDS]: {
    type: K;
    updater: Updater<PaneState[(typeof UPDATER_FIELDS)[K]]>;
  };
}[keyof typeof UPDATER_FIELDS];

export type PaneAction = ValueAction | UpdaterAction;

export function paneReducer(state: PaneState, action: PaneAction): PaneState {
  if ('updater' in action) {
    const field = UPDATER_FIELDS[action.type];
    // The union is generated from the table above, so the updater always
    // matches the field it is paired with. TypeScript cannot follow that
    // correlation across a union, so `resolve` is instantiated at `unknown`
    // — every updater is assignable to `Updater<unknown>`.
    return {
      ...state,
      [field]: resolve<unknown>(action.updater, state[field]),
    };
  }

  const field = VALUE_FIELDS[action.type];
  return { ...state, [field]: action.value };
}

// ── Actions wrapper (preserves same setter API for input handlers) ──

export interface PaneActions {
  setPaneMode: (mode: PaneMode) => void;
  setReconnectKey: (updater: Updater<number>) => void;
  setDiffFileIndex: (updater: Updater<number>) => void;
  setDiffViewFile: (file: string | null) => void;
  setDiffScrollOffset: (updater: Updater<number>) => void;
  setDiffListScrollRow: (updater: Updater<number>) => void;
  setShowSkipped: (updater: Updater<boolean>) => void;
  setSelectedCommentId: (id: string | null) => void;
  setPendingDeleteCommentId: (id: string | null) => void;
  setEditingCommentId: (id: string | null) => void;
  setEditBuffer: (updater: Updater<string>) => void;
  setReplyingToThreadId: (id: string | null) => void;
  setReplyBuffer: (updater: Updater<string>) => void;
  setPendingScrollThreadId: (id: string | null) => void;
  setGeneralCommentsIndex: (updater: Updater<number>) => void;
  setGeneralCommentsScrollOffset: (updater: Updater<number>) => void;
  setSessionMenu: (updater: Updater<SessionMenuState | null>) => void;
  setReviewInstruction: (updater: Updater<string>) => void;
  setPriorPaneMode: (mode: PaneMode) => void;
  setPlanCheckoutIndex: (updater: Updater<number>) => void;
  setAnnotatingPlanKey: (key: string | null) => void;
  setAnnotationBuffer: (updater: Updater<string>) => void;
  setPlanCheckoutTarget: (value: 'inject' | 'new-session' | null) => void;
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
 * Consolidated pane state machine: pane mode, diff navigation, comment
 * editing, the session menu, and plan checkout.
 *
 * The call site (MainTab) mounts this hook inside a component keyed on
 * the selected sidebar item's identity, so on every item change the
 * hook remounts and `useReducer`'s lazy initializer picks the starting
 * pane mode via `defaultPaneMode`. There is no render-time auto-reset
 * path anymore.
 *
 * Pane state does not track "has this review-PR been started" — the
 * launcher's continue-or-seed intent handles resume-if-possible, which
 * makes a JS-side cache redundant. Returning to a review-PR row whose
 * PTY has exited shows pr-detail; Enter opens the session menu, whose
 * review row resumes the conversation.
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

  // A session-menu request (the branch picker, whose worktree creation
  // lands the user in the new session's menu) is honored by the pane
  // showing that session — whether it was already mounted when the
  // request was filed, or is the mount a selection move produces. The
  // initializer above stays pure; consuming here keeps the take-once
  // semantics out of React's double-invoked init path.
  const requestedFor = useSyncExternalStore(
    subscribeSessionMenuRequest,
    peekSessionMenuRequest
  );
  useEffect(() => {
    if (requestedFor === null || requestedFor !== sessionNameForTerminal) {
      return;
    }
    if (!selectedItem || !consumeSessionMenuRequest(sessionNameForTerminal)) {
      return;
    }
    dispatch({
      type: 'SET_SESSION_MENU',
      updater: openSessionMenuState(getPrFromItem(selectedItem)),
    });
    dispatch({ type: 'SET_PANE_MODE', value: 'confirm' });
  }, [requestedFor, sessionNameForTerminal, selectedItem]);

  const actions = useMemo<PaneActions>(
    () => ({
      setPaneMode: (value) => dispatch({ type: 'SET_PANE_MODE', value }),
      setReconnectKey: (updater) =>
        dispatch({ type: 'SET_RECONNECT_KEY', updater }),
      setDiffFileIndex: (updater) =>
        dispatch({ type: 'SET_DIFF_FILE_INDEX', updater }),
      setDiffViewFile: (value) =>
        dispatch({ type: 'SET_DIFF_VIEW_FILE', value }),
      setDiffScrollOffset: (updater) =>
        dispatch({ type: 'SET_DIFF_SCROLL_OFFSET', updater }),
      setDiffListScrollRow: (updater) =>
        dispatch({ type: 'SET_DIFF_LIST_SCROLL_ROW', updater }),
      setShowSkipped: (updater) =>
        dispatch({ type: 'SET_SHOW_SKIPPED', updater }),
      setSelectedCommentId: (value) =>
        dispatch({ type: 'SET_SELECTED_COMMENT_ID', value }),
      setPendingDeleteCommentId: (value) =>
        dispatch({ type: 'SET_PENDING_DELETE_COMMENT_ID', value }),
      setEditingCommentId: (value) =>
        dispatch({ type: 'SET_EDITING_COMMENT_ID', value }),
      setEditBuffer: (updater) =>
        dispatch({ type: 'SET_EDIT_BUFFER', updater }),
      setReplyingToThreadId: (value) =>
        dispatch({ type: 'SET_REPLYING_TO_THREAD_ID', value }),
      setReplyBuffer: (updater) =>
        dispatch({ type: 'SET_REPLY_BUFFER', updater }),
      setPendingScrollThreadId: (value) =>
        dispatch({ type: 'SET_PENDING_SCROLL_THREAD_ID', value }),
      setGeneralCommentsIndex: (updater) =>
        dispatch({ type: 'SET_GENERAL_COMMENTS_INDEX', updater }),
      setGeneralCommentsScrollOffset: (updater) =>
        dispatch({ type: 'SET_GENERAL_COMMENTS_SCROLL_OFFSET', updater }),
      setSessionMenu: (updater) =>
        dispatch({ type: 'SET_SESSION_MENU', updater }),
      setReviewInstruction: (updater) =>
        dispatch({ type: 'SET_REVIEW_INSTRUCTION', updater }),
      setPriorPaneMode: (value) =>
        dispatch({ type: 'SET_PRIOR_PANE_MODE', value }),
      setPlanCheckoutIndex: (updater) =>
        dispatch({ type: 'SET_PLAN_CHECKOUT_INDEX', updater }),
      setAnnotatingPlanKey: (value) =>
        dispatch({ type: 'SET_ANNOTATING_PLAN_KEY', value }),
      setAnnotationBuffer: (updater) =>
        dispatch({ type: 'SET_ANNOTATION_BUFFER', updater }),
      setPlanCheckoutTarget: (value) =>
        dispatch({ type: 'SET_PLAN_CHECKOUT_TARGET', value }),
    }),
    []
  );

  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}
