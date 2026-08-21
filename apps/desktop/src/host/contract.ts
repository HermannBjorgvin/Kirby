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
import type { SettingsField } from '@kirby/app-core';
import type { WorktreeInfo } from '@kirby/worktree-manager';
import type {
  BranchPrMap,
  PullRequestComments,
  RemoteCommentThread,
} from '@kirby/vcs-core';

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

  // ── Config ───────────────────────────────────────────────────
  getConfig(): Promise<AppConfig>;
  /** Update one settings field (same bag semantics as the CLI). */
  updateSettingsField(
    field: SettingsField,
    value: string | undefined
  ): Promise<AppConfig>;

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
  getRepo: 'kirby/repo/get',
  getConfig: 'kirby/config/get',
  updateSettingsField: 'kirby/config/update-field',
  listWorktrees: 'kirby/worktree/list',
  listBranches: 'kirby/worktree/branches',
  createWorktree: 'kirby/worktree/create',
  removeWorktree: 'kirby/worktree/remove',
  canRemoveBranch: 'kirby/worktree/can-remove',
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
