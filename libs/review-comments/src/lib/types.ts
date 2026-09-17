export type CommentSeverity = 'critical' | 'major' | 'minor' | 'nit';

/**
 * A draft is anchored to a line range, to a whole file, or to the pull
 * request itself — the same three shapes a remote thread comes in.
 *
 * The provider rejects a line anchor outside the diff, and a remark
 * about unchanged code or about the change as a whole has no line to
 * sit on. Nullable `file`/`lineStart`/`lineEnd` mirror
 * `RemoteCommentThread`, so every surface that already lists a general
 * thread ahead of the inline ones can list a general draft the same
 * way. See `commentAnchor`.
 */
export interface ReviewComment {
  id: string;
  /** Repo-relative path, or null for a remark about the whole pull request. */
  file: string | null;
  /** 1-based, inclusive; null for a remark about the whole file (or PR). */
  lineStart: number | null;
  lineEnd: number | null;
  severity: CommentSeverity;
  body: string;
  side: 'LEFT' | 'RIGHT';
  status: 'draft' | 'posting' | 'posted';
  createdAt: string;
  /**
   * The provider's id for an existing review thread this draft was
   * written in answer to, when it was (`n10 util add-comment
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
