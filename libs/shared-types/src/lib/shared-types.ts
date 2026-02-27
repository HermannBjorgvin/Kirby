// Azure DevOps PR types
export type ReviewerVote = 10 | 5 | 0 | -5 | -10;

export interface PullRequestReviewer {
  displayName: string;
  vote: ReviewerVote;
}

export interface PullRequestInfo {
  pullRequestId: number;
  sourceBranch: string;
  isDraft: boolean;
  reviewers: PullRequestReviewer[];
  activeCommentCount: number;
  createdByUniqueName?: string;
}

export type BranchPrMap = Record<string, PullRequestInfo | null>;

export interface Config {
  /** Azure DevOps personal access token */
  pat?: string;
  /** Azure DevOps organization URL */
  org?: string;
  /** Azure DevOps project name */
  project?: string;
  /** Default repository name */
  repo?: string;
  /** User email (for filtering own PRs) */
  email?: string;
  /** capture-pane polling interval in ms */
  pollInterval: number;
  /** PR data polling interval in ms */
  prPollInterval?: number;
}

export const DEFAULT_CONFIG: Config = {
  pollInterval: 500,
};

export interface GlobalConfig {
  pat?: string;
  pollInterval: number;
  prPollInterval?: number;
}

export interface ProjectConfig {
  org?: string;
  project?: string;
  repo?: string;
  email?: string;
}

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = { pollInterval: 500 };
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {};
