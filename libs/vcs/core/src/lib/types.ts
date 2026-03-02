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
}

export interface AppConfig {
  email?: string;
  prPollInterval?: number;
  aiCommand?: string;
  worktreePath?: string;
  vendor?: string;
  vendorAuth: Record<string, string>;
  vendorProject: Record<string, string>;
  autoDeleteOnMerge?: boolean;
  autoRebase?: boolean;
  mergePollInterval?: number; // ms, default 3600000, min 300000
}
