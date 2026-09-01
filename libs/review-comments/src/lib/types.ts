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
  /**
   * The provider's id for an existing review thread this draft was
   * written in answer to, when it was (`kirby util add-comment
   * --thread=…`). Recorded rather than acted on: posting still opens a
   * new thread at the draft's own file and line, so a draft that names
   * a thread is a draft whose *subject* is that conversation, and the
   * reader can see which one before posting it.
   *
   * Both providers hand out an id that survives: a GitHub review
   * thread node id or issue-comment node id, an Azure DevOps thread
   * id. It is the same string `RemoteCommentThread.id` carries.
   */
  threadId?: string;
}

export interface ReviewCommentsFile {
  prId: number;
  comments: ReviewComment[];
}
