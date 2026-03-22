export type CommentSeverity = 'critical' | 'major' | 'minor' | 'nit';

export interface ReviewComment {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: CommentSeverity;
  body: string;
  side: 'LEFT' | 'RIGHT';
  status: 'draft' | 'posting' | 'posted';
  createdAt: string;
}

export interface ReviewCommentsFile {
  prId: number;
  comments: ReviewComment[];
}
