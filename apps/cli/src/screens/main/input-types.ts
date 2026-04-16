import type { DiffFile, ReviewComment, SidebarItem } from '../../types.js';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AppStateContextValue } from '../../context/AppStateContext.js';
import type { SessionActionsContextValue } from '../../context/SessionContext.js';
import type { ConfigContextValue } from '../../context/ConfigContext.js';
import type { SidebarContextValue } from '../../context/SidebarContext.js';
import type { KeybindContextValue } from '../../context/KeybindContext.js';
import type {
  NavValue,
  AsyncOpsValue,
  SettingsValue,
  TerminalLayout,
} from '../../input-handlers.js';
import type { PaneModeValue } from '../../hooks/usePaneReducer.js';
import type { CommentPositionInfo } from '@kirby/review-comments';

// ── Context slice types ──────────────────────────────────────────

export type BranchPickerValue = AppStateContextValue['branchPicker'];
export type DeleteConfirmValue = AppStateContextValue['deleteConfirm'];

// ── Shared context interfaces ────────────────────────────────────

export interface BranchPickerHandlerCtx {
  branchPicker: BranchPickerValue;
  sessions: SessionActionsContextValue;
  sidebar: SidebarContextValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
  keybinds: KeybindContextValue;
}

export interface DeleteConfirmHandlerCtx {
  deleteConfirm: DeleteConfirmValue;
  sessions: SessionActionsContextValue;
  asyncOps: AsyncOpsValue;
  keybinds: KeybindContextValue;
}

export interface DiffFileListHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  diffDisplayCount: number;
  loadDiffText: () => Promise<void>;
  keybinds: KeybindContextValue;
}

export interface CommentContext {
  comments: ReviewComment[];
  prId: number;
  positions: Map<string, CommentPositionInfo>;
  selectedReviewPr: PullRequestInfo;
}

export interface DiffViewerHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  terminal: TerminalLayout;
  diffTotalLines: number;
  commentCtx?: CommentContext;
  config: ConfigContextValue;
  sessions: SessionActionsContextValue;
  asyncOps: AsyncOpsValue;
  keybinds: KeybindContextValue;
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
  exit: () => void;
}
