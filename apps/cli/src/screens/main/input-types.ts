import type { DiffFile, ReviewComment, SidebarItem } from '../../types.js';
import type { PullRequestInfo } from '@kirby/vcs-core';
import type { AppStateContextValue } from '../../context/AppStateContext.js';
import type { SessionContextValue } from '../../context/SessionContext.js';
import type { ConfigContextValue } from '../../context/ConfigContext.js';
import type { SidebarContextValue } from '../../context/SidebarContext.js';
import type {
  NavValue,
  AsyncOpsValue,
  SettingsValue,
  TerminalLayout,
} from '../../input-handlers.js';
import type { PaneModeValue } from '../../hooks/usePaneMode.js';
import type { CommentPositionInfo } from '../../utils/comment-renderer.js';

// ── Context slice types ──────────────────────────────────────────

export type BranchPickerValue = AppStateContextValue['branchPicker'];
export type DeleteConfirmValue = AppStateContextValue['deleteConfirm'];

// ── Shared context interfaces ────────────────────────────────────

export interface BranchPickerHandlerCtx {
  branchPicker: BranchPickerValue;
  sessions: SessionContextValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
}

export interface DeleteConfirmHandlerCtx {
  deleteConfirm: DeleteConfirmValue;
  sessions: SessionContextValue;
  asyncOps: AsyncOpsValue;
}

export interface DiffFileListHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  diffDisplayCount: number;
  loadDiffText: () => Promise<void>;
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
  sessions: SessionContextValue;
}

export interface ConfirmHandlerCtx {
  pane: PaneModeValue;
  nav: NavValue;
  asyncOps: AsyncOpsValue;
  sessions: SessionContextValue;
  sidebar: SidebarContextValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
  selectedItem: SidebarItem | undefined;
  sessionNameForTerminal: string | null;
}

export interface SidebarInputCtx {
  nav: NavValue;
  config: ConfigContextValue;
  sessions: SessionContextValue;
  sidebar: SidebarContextValue;
  branchPicker: BranchPickerValue;
  deleteConfirm: DeleteConfirmValue;
  settings: SettingsValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  pane: PaneModeValue;
  exit: () => void;
}
