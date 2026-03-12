export type ActiveTab = 'sessions' | 'reviews';

export type Focus = 'sidebar' | 'terminal';

export type ReviewPane =
  | 'detail'
  | 'diff'
  | 'diff-file'
  | 'confirm'
  | 'terminal';

export interface AgentSession {
  name: string;
  running: boolean;
}

export interface DiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  binary: boolean;
  previousFilename?: string;
}

export type FileCategory = 'normal' | 'binary' | 'lockfile' | 'generated';

// ── Review comments ──────────────────────────────────────────────

export type CommentSeverity = 'critical' | 'major' | 'minor' | 'nit';

export interface ReviewComment {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: CommentSeverity;
  body: string;
  side: 'LEFT' | 'RIGHT';
  status: 'draft' | 'posted';
  createdAt: string;
}

export interface ReviewCommentsFile {
  prId: number;
  comments: ReviewComment[];
}
