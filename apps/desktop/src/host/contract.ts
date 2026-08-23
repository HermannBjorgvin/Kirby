/**
 * Typed contract between the Electron main process and the renderer.
 *
 * The preload script exposes exactly this shape as `window.kirby` via
 * contextBridge; the main process implements it behind ipcMain
 * handlers. Both sides import these types from this file so the
 * compiler keeps the bridge honest.
 *
 * Process model: the renderer is sandboxed (no Node). All filesystem,
 * git, and VCS-provider work happens in the main process through the
 * existing @kirby libs. The host holds one "active repo" — desktop is
 * single-repo-per-window, matching how the CLI runs inside a repo.
 */

import type { AppConfig, PullRequestInfo } from '@kirby/vcs-core';
import type { LaunchIntent, SidebarItem } from '@kirby/app-core';
import type { CommentSeverity, ReviewComment } from '@kirby/review-comments';
export type { CommentSeverity, ReviewComment };
import type { WorktreeInfo } from '@kirby/worktree-manager';
import type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentReply,
  RemoteCommentThread,
} from '@kirby/vcs-core';
export type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentReply,
  RemoteCommentThread,
};
export type { SidebarItem } from '@kirby/app-core';

export interface KirbyVersionInfo {
  /** kirby-desktop package version */
  app: string;
  electron: string;
  node: string;
  chrome: string;
}

// ── Repo ─────────────────────────────────────────────────────────

export interface RepoInfo {
  cwd: string;
  providerId: string | null;
  vcsConfigured: boolean;
}

// ── Sessions (agent terminals) ───────────────────────────────────

export interface SessionLaunchRequest {
  branch: string;
  intent: LaunchIntent;
  prompt?: string;
  /** Delivered as a native system prompt for agents that support it. */
  systemGuidance?: string;
  /** Initial PTY size — the renderer knows the real pane geometry. */
  cols?: number;
  rows?: number;
}

export interface SessionSummary {
  name: string;
  running: boolean;
  spawnedAt: number;
}

export interface SessionDataEvent {
  name: string;
  data: string;
  /** Monotonic per-session chunk counter; lets a late subscriber drop
   *  chunks already covered by a `getSessionBuffer` snapshot. */
  seq: number;
}

/** Snapshot of a session's recent output (host-side ring buffer). */
export interface SessionBuffer {
  data: string;
  /** seq of the last chunk included in `data`. */
  seq: number;
}

export interface SessionExitEvent {
  name: string;
  code: number;
}

/** Channels the main process pushes events on (ipcRenderer.on). */
export const SESSION_EVENTS = {
  data: 'kirby/session/data',
  exit: 'kirby/session/exit',
} as const;

// ── Settings ─────────────────────────────────────────────────────

export type SettingsGroup =
  | 'general'
  | 'agent'
  | 'sync'
  | 'terminal'
  | 'provider';

/** One row of the settings form: the field plus its current value. */
export interface SettingsFieldView {
  label: string;
  key: string;
  masked?: boolean;
  description?: string;
  presets?: { name: string; value: string | null }[];
  value: string;
  /** Section the desktop settings page files this field under. */
  group: SettingsGroup;
  /** Widget hint derived from the presets shape. */
  kind: 'boolean' | 'select' | 'text';
}

// ── Recent repos ─────────────────────────────────────────────────

export interface RecentRepoEntry {
  cwd: string;
  lastOpenedAt: number;
  /** Re-validated against the filesystem at list time. */
  valid: boolean;
}

// ── Sync (remote PR data) ────────────────────────────────────────

export interface SyncState {
  providerId: string | null;
  providerConfigured: boolean;
  /** ms-epoch of the last successful remote fetch, null if never. */
  lastRemoteSyncAt: number | null;
  remoteError: string | null;
  remoteSyncing: boolean;
  /** Remote cache TTL in ms (from config, clamped). */
  remoteIntervalMs: number;
}

// ── Desktop shell (native menus, prefs) ──────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';

export interface DesktopPrefs {
  theme: ThemePreference;
  /** Use the OS window frame + native menu bar instead of the custom
   *  title bar. Applied on next launch. */
  nativeFrame: boolean;
}

/** Commands the native application menu sends to the renderer. */
export type MenuCommand =
  | 'open-repo'
  | 'switch-repo'
  | 'new-worktree'
  | 'open-settings'
  | 'close-tab'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'refresh-remote'
  | 'set-theme'
  | 'open-url'
  | 'show-shortcuts'
  | 'about';

export interface MenuCommandEvent {
  command: MenuCommand;
  arg?: string;
}

/** One entry of a native context menu. */
export type ContextMenuItem =
  | { type: 'separator' }
  | {
      id: string;
      label: string;
      enabled?: boolean;
      /** Render as a destructive action where the platform supports it. */
      danger?: boolean;
    };

export const MENU_EVENTS = {
  command: 'kirby/menu/command',
} as const;

// ── Reviews ──────────────────────────────────────────────────────

export interface ReplyRequest {
  prId: number;
  thread: RemoteCommentThread;
  body: string;
}

export interface ResolveRequest {
  prId: number;
  thread: RemoteCommentThread;
  resolved: boolean;
}

/** Launch (or resume) an AI review of a PR in its worktree. */
export interface ReviewLaunchRequest {
  pr: PullRequestInfo;
  /** Extra user instruction appended to the review task prompt. */
  instruction?: string;
  cols?: number;
  rows?: number;
}

export interface PostDraftsRequest {
  prId: number;
  /** Subset to post; every draft when omitted. */
  ids?: string[];
  /** Required for GitHub (review API). */
  headSha?: string;
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
}

/** An image embedded in a comment, fetched host-side with provider auth. */
export interface CommentImagePayload {
  dataUrl: string;
  contentType: string;
  bytes: number;
}

/** The API surface exposed on `window.kirby`. */
export interface KirbyHostApi {
  getVersion(): Promise<KirbyVersionInfo>;

  // ── Repo ─────────────────────────────────────────────────────
  /** Validate + open a directory as the active repo. */
  openRepo(cwd: string): Promise<RepoInfo>;
  getRepo(): Promise<RepoInfo | null>;

  // ── Recent repos ─────────────────────────────────────────────
  listRecentRepos(): Promise<RecentRepoEntry[]>;
  /** Native folder picker. Resolves to the chosen path, or null when
   *  the user cancels. */
  selectRepoDirectory(): Promise<string | null>;
  forgetRecent(cwd: string): Promise<void>;

  // ── Config / settings ────────────────────────────────────────
  getConfig(): Promise<AppConfig>;
  /** Settings form model: every editable field with its current
   *  resolved display value (same semantics as the CLI's panel). */
  getSettingsView(): Promise<SettingsFieldView[]>;
  /** Update one settings field (same bag semantics as the CLI). */
  updateSettingsField(
    ref: { label: string; key: string },
    value: string
  ): Promise<void>;

  // ── Sidebar (unified worktrees + PRs + reviews, TUI order) ────
  getSidebarModel(): Promise<SidebarItem[]>;
  getSyncState(): Promise<SyncState>;
  /** Drop the remote PR cache and re-fetch now. */
  refreshRemote(): Promise<void>;

  // ── Worktrees ────────────────────────────────────────────────
  listWorktrees(): Promise<WorktreeInfo[]>;
  listBranches(): Promise<string[]>;
  /** All local + remote branch names (checkout candidates). */
  listAllBranches(): Promise<string[]>;
  createWorktree(branch: string): Promise<string | null>;
  removeWorktree(branch: string, force: boolean): Promise<boolean>;
  canRemoveBranch(
    branch: string
  ): Promise<{ safe: true } | { safe: false; reason: string }>;

  // ── Reviews ──────────────────────────────────────────────────
  fetchPullRequests(): Promise<BranchPrMap>;
  fetchCommentThreads(prId: number): Promise<PullRequestComments>;
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
  /** Download a comment image with the provider's credentials (Azure
   *  DevOps PAT / GitHub token) and return it as a data URL. */
  fetchCommentImage(url: string): Promise<CommentImagePayload | null>;

  // ── Draft review comments (from the review agent) ─────────────
  listDraftComments(prId: number): Promise<ReviewComment[]>;
  updateDraftComment(
    prId: number,
    id: string,
    patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
  ): Promise<void>;
  deleteDraftComment(prId: number, id: string): Promise<void>;
  /** Resolves to the number of comments posted. */
  postDraftComments(req: PostDraftsRequest): Promise<number>;

  // ── Sessions ─────────────────────────────────────────────────
  launchAgent(req: SessionLaunchRequest): Promise<{ name: string }>;
  /** Create the PR's worktree if needed and start/continue a review
   *  session seeded with the shared review prompt + guidance. */
  launchReviewAgent(req: ReviewLaunchRequest): Promise<{ name: string }>;
  listSessions(): Promise<SessionSummary[]>;
  /** Recent output for a session so a (re)mounted terminal can replay
   *  what it missed before subscribing to live data. */
  getSessionBuffer(name: string): Promise<SessionBuffer>;
  writeSession(name: string, data: string): Promise<void>;
  resizeSession(name: string, cols: number, rows: number): Promise<void>;
  killSession(name: string): Promise<void>;
  /** Subscribe to PTY output. Returns an unsubscribe function. */
  onSessionData(cb: (payload: SessionDataEvent) => void): () => void;
  onSessionExit(cb: (payload: SessionExitEvent) => void): () => void;

  // ── Diff ─────────────────────────────────────────────────────
  fetchDiffText(sourceBranch: string, targetBranch: string): Promise<string>;
  fetchFileDiffText(
    sourceBranch: string,
    targetBranch: string,
    file: string
  ): Promise<string>;

  // ── Shell ────────────────────────────────────────────────────
  /** Open a URL in the user's default browser. */
  openExternal(url: string): Promise<void>;
  /** Show a native context menu at the cursor; resolves to the chosen
   *  item id, or null when dismissed. */
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>;
  /** Pop the application menu (used by the custom title bar's menu
   *  button on platforms without a visible native menu bar). */
  showAppMenu(): Promise<void>;
  /** Subscribe to native menu commands. Returns an unsubscribe fn. */
  onMenuCommand(cb: (payload: MenuCommandEvent) => void): () => void;
  getDesktopPrefs(): Promise<DesktopPrefs>;
  setDesktopPrefs(patch: Partial<DesktopPrefs>): Promise<DesktopPrefs>;
  /** Native about box. */
  showAbout(): Promise<void>;
}

/** IPC channel names — single source of truth for main and preload. */
export const IPC = {
  getVersion: 'kirby/version',
  openRepo: 'kirby/repo/open',
  listRecentRepos: 'kirby/repo/recents',
  selectRepoDirectory: 'kirby/repo/select-directory',
  forgetRecent: 'kirby/repo/forget',
  getRepo: 'kirby/repo/get',
  getConfig: 'kirby/config/get',
  getSettingsView: 'kirby/settings/view',
  updateSettingsField: 'kirby/config/update-field',
  getSidebarModel: 'kirby/sidebar/model',
  getSyncState: 'kirby/sidebar/sync-state',
  refreshRemote: 'kirby/sidebar/refresh-remote',
  listWorktrees: 'kirby/worktree/list',
  listBranches: 'kirby/worktree/branches',
  listAllBranches: 'kirby/worktree/all-branches',
  createWorktree: 'kirby/worktree/create',
  removeWorktree: 'kirby/worktree/remove',
  canRemoveBranch: 'kirby/worktree/can-remove',
  launchAgent: 'kirby/session/launch',
  listSessions: 'kirby/session/list',
  getSessionBuffer: 'kirby/session/buffer',
  writeSession: 'kirby/session/write',
  resizeSession: 'kirby/session/resize',
  killSession: 'kirby/session/kill',
  fetchPullRequests: 'kirby/reviews/prs',
  fetchCommentThreads: 'kirby/reviews/comments',
  replyToThread: 'kirby/reviews/reply',
  setThreadResolved: 'kirby/reviews/resolve',
  fetchCommentImage: 'kirby/reviews/comment-image',
  listDraftComments: 'kirby/drafts/list',
  updateDraftComment: 'kirby/drafts/update',
  deleteDraftComment: 'kirby/drafts/delete',
  postDraftComments: 'kirby/drafts/post',
  launchReviewAgent: 'kirby/session/launch-review',
  fetchDiffText: 'kirby/diff/text',
  fetchFileDiffText: 'kirby/diff/file-text',
  openExternal: 'kirby/shell/open-external',
  showContextMenu: 'kirby/shell/context-menu',
  showAppMenu: 'kirby/shell/app-menu',
  getDesktopPrefs: 'kirby/shell/prefs/get',
  setDesktopPrefs: 'kirby/shell/prefs/set',
  showAbout: 'kirby/shell/about',
} as const;

/** Error thrown by host handlers when no repo has been opened yet. */
export class NoActiveRepoError extends Error {
  constructor() {
    super('No repository is open');
    this.name = 'NoActiveRepoError';
  }
}
