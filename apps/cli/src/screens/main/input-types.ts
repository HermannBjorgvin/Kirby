import type { DiffFile, ReviewComment, SidebarItem } from '../../types.js';
import type {
  PullRequestInfo,
  RemoteCommentThread,
  RemoteCommentReply,
} from '@kirby/vcs-core';
import type { SessionActionsContextValue } from '../../context/SessionContext.js';
import type { ConfigContextValue } from '../../context/ConfigContext.js';
import type { SidebarContextValue } from '../../context/SidebarContext.js';
import type {
  KeybindContextValue,
  KeybindResolveValue,
} from '../../context/KeybindContext.js';
import type {
  BranchPickerValue as BranchPickerModalValue,
  DeleteConfirmValue as DeleteConfirmModalValue,
} from '../../context/ModalContext.js';
import type {
  NavValue,
  AsyncOpsValue,
  SettingsValue,
  TerminalLayout,
} from '../../input-handlers.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { CommentPositionInfo } from '@kirby/review-comments';

// ── Context slice types ──────────────────────────────────────────

export type BranchPickerValue = BranchPickerModalValue;
export type DeleteConfirmValue = DeleteConfirmModalValue;

// ── Shared context interfaces ────────────────────────────────────

export interface BranchPickerHandlerCtx {
  branchPicker: BranchPickerValue;
  sessions: SessionActionsContextValue;
  sidebar: SidebarContextValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
  keybinds: KeybindResolveValue;
}

export interface DeleteConfirmHandlerCtx {
  deleteConfirm: DeleteConfirmValue;
  sessions: SessionActionsContextValue;
  asyncOps: AsyncOpsValue;
  keybinds: KeybindResolveValue;
}

export interface DiffFileListHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  /** Total j/k steps — fileCount + shownGeneralComments.length */
  diffDisplayCount: number;
  /** How many file rows precede the comment footer. Indices ≥ this
   *  value select a footer comment instead of a file. */
  fileCount: number;
  /** Threads actually rendered in the footer, in display order.
   *  `r`/Enter on one enters inline reply mode; `v` toggles resolved. */
  shownGeneralComments: RemoteCommentThread[];
  keybinds: KeybindResolveValue;
  /** Reply/resolve delegate — same primitives used by the diff viewer
   *  and the Shift+C pane so the footer behaves identically. */
  remoteCtx: {
    replyToThread: (
      threadId: string,
      body: string
    ) => Promise<RemoteCommentReply>;
    toggleResolved: (threadId: string, resolved: boolean) => Promise<boolean>;
  };
  sessions: SessionActionsContextValue;
}

export interface CommentContext {
  comments: ReviewComment[];
  prId: number;
  positions: Map<string, CommentPositionInfo>;
  selectedReviewPr: PullRequestInfo;
}

export interface RemoteCommentContext {
  threads: RemoteCommentThread[];
  replyToThread: (
    threadId: string,
    body: string
  ) => Promise<RemoteCommentReply>;
  toggleResolved: (threadId: string, resolved: boolean) => Promise<boolean>;
  /** Force-refetch remote threads. Used after posting a local comment
   *  so the newly-created remote thread replaces the now-hidden posted
   *  local one without waiting for the user to navigate away and back. */
  refresh: () => void;
}

export interface DiffViewerHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  terminal: TerminalLayout;
  diffTotalLines: number;
  /** Annotated-line indices where a navigable section begins. Used by
   * the Ctrl+↑/↓ section-jump action. First entry is always 0 (diff
   * start); later entries mark out-of-diff comment groups when present. */
  sectionAnchors: number[];
  commentCtx?: CommentContext;
  remoteCtx?: RemoteCommentContext;
  config: ConfigContextValue;
  sessions: SessionActionsContextValue;
  asyncOps: AsyncOpsValue;
  keybinds: KeybindResolveValue;
}

export interface ConfirmHandlerCtx {
  pane: PaneModeValue;
  nav: NavValue;
  asyncOps: AsyncOpsValue;
  sessions: SessionActionsContextValue;
  sidebar: SidebarContextValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
  selectedItem: SidebarItem | undefined;
  sessionNameForTerminal: string | null;
  keybinds: KeybindContextValue;
}

export interface SidebarInputCtx {
  nav: NavValue;
  config: ConfigContextValue;
  sessions: SessionActionsContextValue;
  sidebar: SidebarContextValue;
  branchPicker: BranchPickerValue;
  deleteConfirm: DeleteConfirmValue;
  settings: SettingsValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  pane: PaneModeValue;
  keybinds: KeybindContextValue;
  toggleHints: () => void;
  exit: () => void;
}
