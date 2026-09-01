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

import type { AgentId, PullRequestInfo, ReviewVerdict } from '@kirby/vcs-core';
export type { AgentId, ReviewVerdict };
import type { LaunchIntent, SidebarItem } from '@kirby/core';
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
export type { SidebarItem } from '@kirby/core';

// The push half of the contract — channel names and their payloads.
export * from './contract-events.js';
import type {
  MenuCommandEvent,
  SessionDataEvent,
  SessionExitEvent,
  SyncNoticeEvent,
} from './contract-events.js';

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
  /**
   * Launch this agent instead of the configured one — the session
   * menu's per-launch pick. Unset means the configured default, which
   * also covers a custom `aiCommand` (the hidden test runner).
   */
  agentId?: AgentId;
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

/**
 * One row of the session menu's agent picker. The configured agent
 * comes first, labelled as the default; `id` is the registry id, or
 * `'test'` for a custom `aiCommand`, which only ever appears in that
 * first row.
 */
export interface AgentOptionView {
  id: AgentId | 'test';
  name: string;
}

/** Snapshot of a session's recent output (host-side ring buffer). */
export interface SessionBuffer {
  data: string;
  /** seq of the last chunk included in `data`. */
  seq: number;
}

// ── Settings ─────────────────────────────────────────────────────

export type SettingsGroup =
  | 'general'
  | 'agent'
  | 'sync'
  | 'terminal'
  | 'provider';

/** Stand-in the host sends instead of a stored secret. Sending it back
 *  unchanged is a no-op write, so the real credential never has to
 *  leave the main process for the settings form to work. */
export const SECRET_PLACEHOLDER = '••••••••';

/** One row of the settings form: the field plus its current value. */
export interface SettingsFieldView {
  label: string;
  key: string;
  masked?: boolean;
  description?: string;
  presets?: { name: string; value: string | null }[];
  value: string;
  /** The value in force while `value` is empty, when the host decides
   *  it at read time (the terminal backend resolves from the tmux
   *  probe). The page shows that preset, marked as the default. */
  defaultValue?: string;
  /** Section the desktop settings page files this field under. */
  group: SettingsGroup;
  /** Widget hint derived from the presets shape. */
  kind: 'boolean' | 'select' | 'text';
  /** When set, the control is not editable right now — the string is
   *  the human-readable reason (shown next to the description). */
  disabled?: string;
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
  /** ms-epoch of the last git sync pass (fetch + ff main), null if never. */
  lastGitSyncAt: number | null;
  remoteError: string | null;
  remoteSyncing: boolean;
  /** Remote cache TTL in ms (from config, clamped). */
  remoteIntervalMs: number;
  /**
   * Provider fetches this process has started, successful or not.
   *
   * Monotonic and diagnostic: it is how "did that actually go and
   * ask?" gets a yes or no. A test — or a curious user reading the
   * sync popover — cannot tell a refetch from a cache hit by watching
   * `lastRemoteSyncAt`, which only moves when a fetch succeeds.
   */
  remoteFetches: number;
}

// ── Desktop shell (native menus, prefs) ──────────────────────────

export type ThemePreference = 'system' | 'light' | 'dark';

export interface DesktopPrefs {
  theme: ThemePreference;
  /** Use the OS window frame + native menu bar instead of the custom
   *  title bar. Applied on next launch. */
  nativeFrame: boolean;
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

/** Mirror of app-core's ActivitySnapshot, redeclared so the renderer
 *  contract stays free of app-core imports. */
export interface SessionActivitySnapshot {
  active: boolean;
  flashing: boolean;
  exited?: boolean;
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

/** Launch (or resume) an AI review of a PR in its worktree. */
export interface ReviewLaunchRequest {
  pr: PullRequestInfo;
  /** Extra user instruction appended to the review task prompt. */
  instruction?: string;
  cols?: number;
  rows?: number;
}

/**
 * Deliver a plan — the comments the user queued for this pull request,
 * already composed into one prompt — to the agent in its worktree.
 *
 * The prompt is composed in the renderer rather than here because the
 * plan pane shows the user the exact text before sending it, and
 * composing it twice is how the preview and the delivery drift apart.
 */
export interface PlanCheckoutRequest {
  pr: PullRequestInfo;
  /** Output of `composePlanPrompt` — sent verbatim. */
  prompt: string;
  /**
   * Only meaningful when an agent is already running on the branch:
   * `inject` types the plan into the conversation it is already having,
   * `new-session` restarts it seeded with the plan.
   */
  mode: 'inject' | 'new-session';
  /** Initial PTY size for a spawn — the renderer knows the pane. */
  cols?: number;
  rows?: number;
}

/** What checkout did, so the renderer can say which one happened. */
export type PlanCheckoutResult = 'injected' | 'spawned';

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
  // NOTE: there is deliberately no `getConfig` on this bridge. It
  // returned the whole AppConfig — provider PAT and token included — to
  // a renderer that displays remote content. Settings are edited
  // through the masked `SettingsFieldView` instead.
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
  /** Open the branch's worktree in the configured external editor
   *  (config.editor, falling back to $VISUAL / $EDITOR — same as the
   *  TUI). Creates the worktree if needed. Resolves to the editor
   *  command used. */
  openInEditor(branch: string): Promise<{ editor: string }>;

  // ── Reviews ──────────────────────────────────────────────────
  fetchPullRequests(): Promise<BranchPrMap>;
  fetchCommentThreads(prId: number): Promise<PullRequestComments>;
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
  /** Full PR description (list payloads truncate or omit it). */
  fetchPrDescription(prId: number): Promise<string>;
  /** Cast the current user's review verdict on a PR. */
  submitReviewVerdict(prId: number, verdict: ReviewVerdict): Promise<void>;
  /** The reviewer-list identifier of the authenticated user (GitHub
   *  login / ADO email), for optimistic reviewer patches. */
  getReviewViewer(): Promise<{ identifier: string } | null>;
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
  /** The agents the session menu offers, configured default first. */
  listAgentOptions(): Promise<AgentOptionView[]>;
  /** Send a composed plan to the PR's agent, creating the worktree and
   *  starting one when there is none. Rejects with the reason on
   *  failure, leaving the plan intact for a retry. */
  checkoutPlan(req: PlanCheckoutRequest): Promise<PlanCheckoutResult>;
  listSessions(): Promise<SessionSummary[]>;
  /** Debounced per-session agent activity (same registry as the TUI's
   *  sidebar spinner): `active` = producing output now, `flashing` =
   *  went idle after a real work streak and the user hasn't looked. */
  getSessionActivity(): Promise<Record<string, SessionActivitySnapshot>>;
  /** The user is looking at this session — clears its flashing state. */
  markSessionSeen(name: string): Promise<void>;
  /** Recent output for a session so a (re)mounted terminal can replay
   *  what it missed before subscribing to live data. */
  getSessionBuffer(name: string): Promise<SessionBuffer>;
  writeSession(name: string, data: string): Promise<void>;
  resizeSession(name: string, cols: number, rows: number): Promise<void>;
  killSession(name: string): Promise<void>;
  /** Write an image pasted into a terminal to a temp file and return
   *  its path, which is how a terminal agent can be given a picture —
   *  a PTY carries text, not bytes. Rejects anything that is not a
   *  recognised image type. */
  saveClipboardImage(data: Uint8Array, mimeType: string): Promise<string>;
  /** Subscribe to PTY output. Returns an unsubscribe function. */
  onSessionData(cb: (payload: SessionDataEvent) => void): () => void;
  onSessionExit(cb: (payload: SessionExitEvent) => void): () => void;

  // ── Diff ─────────────────────────────────────────────────────
  fetchDiffText(sourceBranch: string, targetBranch: string): Promise<string>;
  /** Diff of a branch's worktree against its base including uncommitted
   *  and untracked work — what an agent has done so far, as opposed to
   *  what it has committed. Empty string when the branch has no
   *  worktree. */
  fetchWorktreeDiffText(branch: string, targetBranch: string): Promise<string>;
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
  /** Toast-worthy events from the host's remote sync loop. */
  onSyncNotice(cb: (notice: SyncNoticeEvent) => void): () => void;
  /** Fires when a background remote fetch has changed the sidebar
   *  model. Carries no payload — the renderer refetches. */
  onRemoteUpdated(cb: () => void): () => void;
  /** Fires when a worktree or agent session created outside this
   *  process appeared or went away. Carries no payload — the renderer
   *  refetches. */
  onDiscoveryChanged(cb: () => void): () => void;
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
  openInEditor: 'kirby/worktree/open-in-editor',
  launchAgent: 'kirby/session/launch',
  listSessions: 'kirby/session/list',
  getSessionActivity: 'kirby/session/activity',
  markSessionSeen: 'kirby/session/seen',
  getSessionBuffer: 'kirby/session/buffer',
  writeSession: 'kirby/session/write',
  resizeSession: 'kirby/session/resize',
  killSession: 'kirby/session/kill',
  saveClipboardImage: 'kirby/session/clipboard-image',
  fetchPullRequests: 'kirby/reviews/prs',
  fetchCommentThreads: 'kirby/reviews/comments',
  replyToThread: 'kirby/reviews/reply',
  setThreadResolved: 'kirby/reviews/resolve',
  fetchPrDescription: 'kirby/reviews/pr-description',
  submitReviewVerdict: 'kirby/reviews/submit-verdict',
  getReviewViewer: 'kirby/reviews/viewer',
  fetchCommentImage: 'kirby/reviews/comment-image',
  listDraftComments: 'kirby/drafts/list',
  updateDraftComment: 'kirby/drafts/update',
  deleteDraftComment: 'kirby/drafts/delete',
  postDraftComments: 'kirby/drafts/post',
  launchReviewAgent: 'kirby/session/launch-review',
  listAgentOptions: 'kirby/session/agent-options',
  checkoutPlan: 'kirby/session/checkout-plan',
  fetchDiffText: 'kirby/diff/text',
  fetchWorktreeDiffText: 'kirby/diff/worktree-text',
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
