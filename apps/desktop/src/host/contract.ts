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

import type { AppConfig } from '@kirby/vcs-core';
import type { LaunchIntent, SidebarItem } from '@kirby/app-core';
import type { WorktreeInfo } from '@kirby/worktree-manager';
import type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentThread,
} from '@kirby/vcs-core';
export type { BranchPrMap, PullRequestComments, RemoteCommentThread };
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
}

export interface SessionSummary {
  name: string;
  running: boolean;
  spawnedAt: number;
}

export interface SessionDataEvent {
  name: string;
  data: string;
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

/** One row of the settings form: the field plus its current value. */
export interface SettingsFieldView {
  label: string;
  key: string;
  masked?: boolean;
  description?: string;
  presets?: { name: string; value: string | null }[];
  value: string;
}

// ── Recent repos ─────────────────────────────────────────────────

export interface RecentRepoEntry {
  cwd: string;
  lastOpenedAt: number;
  /** Re-validated against the filesystem at list time. */
  valid: boolean;
}

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
  /** Update one settings field (same bag semantics as the CLI). */
  updateSettingsField(
    ref: { label: string; key: string },
    value: string
  ): Promise<void>;

  // ── Sidebar (unified worktrees + PRs + reviews, TUI order) ────
  getSidebarModel(): Promise<SidebarItem[]>;

  // ── Worktrees ────────────────────────────────────────────────
  listWorktrees(): Promise<WorktreeInfo[]>;
  listBranches(): Promise<string[]>;
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

  // ── Sessions ─────────────────────────────────────────────────
  launchAgent(req: SessionLaunchRequest): Promise<{ name: string }>;
  listSessions(): Promise<SessionSummary[]>;
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
  listWorktrees: 'kirby/worktree/list',
  listBranches: 'kirby/worktree/branches',
  createWorktree: 'kirby/worktree/create',
  removeWorktree: 'kirby/worktree/remove',
  canRemoveBranch: 'kirby/worktree/can-remove',
  launchAgent: 'kirby/session/launch',
  listSessions: 'kirby/session/list',
  writeSession: 'kirby/session/write',
  resizeSession: 'kirby/session/resize',
  killSession: 'kirby/session/kill',
  fetchPullRequests: 'kirby/reviews/prs',
  fetchCommentThreads: 'kirby/reviews/comments',
  replyToThread: 'kirby/reviews/reply',
  setThreadResolved: 'kirby/reviews/resolve',
  fetchDiffText: 'kirby/diff/text',
  fetchFileDiffText: 'kirby/diff/file-text',
} as const;

/** Error thrown by host handlers when no repo has been opened yet. */
export class NoActiveRepoError extends Error {
  constructor() {
    super('No repository is open');
    this.name = 'NoActiveRepoError';
  }
}
