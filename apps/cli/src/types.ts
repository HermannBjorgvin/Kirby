import type { PullRequestInfo } from '@kirby/vcs-core';

export type Focus = 'sidebar' | 'terminal';

export type PaneMode =
  | 'terminal'
  | 'pr-detail'
  | 'diff'
  | 'diff-file'
  | 'confirm';

export type ReviewCategory = 'needs-review' | 'waiting' | 'approved';

export type SidebarItem =
  | {
      kind: 'session';
      session: AgentSession;
      pr?: PullRequestInfo;
      branch?: string;
      isMerged: boolean;
      conflictCount?: number;
    }
  | { kind: 'orphan-pr'; pr: PullRequestInfo; running?: boolean }
  | {
      kind: 'review-pr';
      pr: PullRequestInfo;
      category: ReviewCategory;
      running?: boolean;
    };

/** Extract the PR from any sidebar item kind. */
export function getPrFromItem(item: SidebarItem): PullRequestInfo | undefined {
  return item.pr;
}

export interface AgentSession {
  name: string;
  running: boolean;
}

export type { DiffFile, FileCategory } from '@kirby/diff';
export type {
  ReviewComment,
  ReviewCommentsFile,
  CommentSeverity,
} from '@kirby/review-comments';
