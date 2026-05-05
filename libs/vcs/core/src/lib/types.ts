export type ReviewDecision =
  | 'approved'
  | 'changes-requested'
  | 'no-response'
  | 'declined';
export type BuildStatusState = 'succeeded' | 'failed' | 'pending' | 'none';

export interface PullRequestReviewer {
  displayName: string;
  identifier: string;
  decision: ReviewDecision;
}

export interface PullRequestInfo {
  id: number;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  createdByIdentifier: string;
  createdByDisplayName: string;
  isDraft?: boolean;
  reviewers?: PullRequestReviewer[];
  activeCommentCount?: number;
  buildStatus?: BuildStatusState;
  headSha?: string;
}

export type BranchPrMap = Record<string, PullRequestInfo | null>;

export interface CategorizedReviews {
  needsReview: PullRequestInfo[];
  waitingForAuthor: PullRequestInfo[];
  approvedByYou: PullRequestInfo[];
}

export interface VcsConfigField {
  key: string;
  label: string;
  masked?: boolean;
}

export interface VcsProvider {
  readonly id: string;
  readonly displayName: string;
  readonly authFields: VcsConfigField[];
  readonly projectFields: VcsConfigField[];

  /** Return vendor project config if URL matches, null otherwise */
  parseRemoteUrl(url: string): Record<string, string> | null;

  /** Auto-detect additional user/project fields (e.g., username from CLI auth) */
  autoDetectFields?(): Record<string, string> | null;

  /** True when auth + project config have all required fields */
  isConfigured(
    auth: Record<string, string>,
    project: Record<string, string>
  ): boolean;

  /** Does identifier (from PR data) match the current user? */
  matchesUser(identifier: string, config: AppConfig): boolean;

  /** Fetch all active PRs, keyed by source branch */
  fetchPullRequests(
    auth: Record<string, string>,
    project: Record<string, string>
  ): Promise<BranchPrMap>;

  /** Web URL for a specific PR */
  getPullRequestUrl(project: Record<string, string>, prId: number): string;

  /** Return branch names (from the provided list) whose PRs have been merged */
  fetchMergedBranches?(
    auth: Record<string, string>,
    project: Record<string, string>,
    branches: string[]
  ): Promise<Set<string>>;

  /** Fetch all comment threads for a PR (inline + general) */
  fetchCommentThreads?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number
  ): Promise<PullRequestComments>;

  /** Reply to an existing comment thread. The thread is passed (not just
   *  the id) so providers can dispatch on `replyKind` — GitHub review
   *  threads use one mutation, GitHub issue comments (general PR
   *  comments) use another. */
  replyToThread?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    thread: RemoteCommentThread,
    body: string
  ): Promise<RemoteCommentReply>;

  /** Resolve or reopen a comment thread. Callers should check
   *  `thread.canResolve` first — for thread kinds that don't support
   *  resolution (e.g. GitHub issue comments) this call is a no-op. */
  setThreadResolved?(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    thread: RemoteCommentThread,
    resolved: boolean
  ): Promise<void>;
}

// ── Remote comment threads (fetched from VCS providers) ───────────

export interface RemoteCommentReply {
  id: string;
  author: string; // display name (GitHub login / ADO displayName)
  body: string;
  createdAt: string; // ISO 8601
  isMinimized?: boolean; // GitHub: minimized/hidden comments
}

export interface RemoteCommentThread {
  id: string; // thread ID (GitHub: reviewThread or IssueComment node ID, ADO: thread id)
  file: string | null; // null = general PR comment (not file-specific)
  lineStart: number | null; // null for general comments
  lineEnd: number | null;
  side: 'LEFT' | 'RIGHT';
  isResolved: boolean;
  isOutdated: boolean; // true if code has changed since the comment
  /** Whether the backing remote type supports `setThreadResolved`.
   *  GitHub issue-comments (general PR comments) don't; review threads
   *  and all ADO threads do. UI uses this to suppress the [v]resolve
   *  hint and skip the no-op mutation. */
  canResolve: boolean;
  /** Provider-specific hint used at reply time to pick the right
   *  mutation. GitHub review threads use the thread id directly; GitHub
   *  issue comments need the PR node id as the comment subject. ADO
   *  just uses thread id. */
  replyKind?: 'github-issue-comment';
  /** For `replyKind === 'github-issue-comment'`, the GraphQL node id
   *  of the PullRequest the comment lives on (used as `subjectId` of
   *  the `addComment` mutation). Undefined for other kinds. */
  replySubjectId?: string;
  comments: RemoteCommentReply[]; // first entry = root comment, rest = replies
}

export interface PullRequestComments {
  threads: RemoteCommentThread[]; // inline diff comments grouped by thread
  generalComments: RemoteCommentThread[]; // top-level PR comments (not file-specific)
}

/** Key binding descriptor as stored in config (JSON-safe, no ink dependency) */
export interface KeyDescriptorConfig {
  input?: string;
  flags?: Record<string, boolean>;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface AppConfig {
  email?: string;
  prPollInterval?: number;
  aiCommand?: string;
  vendor?: string;
  vendorAuth: Record<string, string>;
  vendorProject: Record<string, string>;
  autoDeleteOnMerge?: boolean;
  autoRebase?: boolean;
  autoHideSidebar?: boolean;
  /** When the user presses Ctrl+Space (escape from terminal) and there
   *  are sessions in the inactive-alert queue, jump focus to the next
   *  alerting session instead of returning to the sidebar. Defaults to
   *  true; set to false to keep the original "Ctrl+Space → sidebar"
   *  behavior. */
  jumpToInactiveOnEscape?: boolean;
  /** Render the diff file list as a collapsed folder tree instead of
   *  a flat path list. Opt-in; defaults to flat for backwards compat. */
  diffFileListTree?: boolean;
  mergePollInterval?: number; // ms, default 3600000, min 300000
  editor?: string;
  worktreePath?: string;
  keybindPreset?: string;
  keybindOverrides?: Record<string, KeyDescriptorConfig[]>;
  /** Which session backend to use. 'pty' (default) spawns the AI
   *  command directly under node-pty. 'tmux' wraps the session in a
   *  tmux session that survives Kirby restarts. Cannot be changed
   *  while sessions are active. */
  terminalBackend?: 'pty' | 'tmux';
}
