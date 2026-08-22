import type { CommentSeverity, ReviewComment } from '@kirby/review-comments';
import type { RemoteCommentThread } from '@kirby/vcs-core';

// ── Plan items ───────────────────────────────────────────────────
//
// A plan item is a *value snapshot* of a comment taken at add-time.
// We deliberately copy body/author/replies/severity/file/line by
// value rather than holding a reference to the live comment: later
// edits, deletes, resolves, or posts to the underlying comment must
// not mutate what the user queued for the agent. Identity for
// toggle/dedupe is `kind + id`.

export interface PlanItemBase {
  /** Repo-relative path, or null for a general (non-file) PR comment. */
  file: string | null;
  /** 1-based line (lineStart snapshot), or null for general comments. */
  line: number | null;
  /** Root/comment body at add-time. */
  body: string;
  /** Optional "Your note:" describing the approach the user wants. */
  annotation?: string;
}

export interface RemotePlanItem extends PlanItemBase {
  kind: 'remote';
  /** RemoteCommentThread.id */
  id: string;
  /** comments[0].author */
  author: string;
  /** comments.slice(1) snapshot (author + body only). */
  replies: { author: string; body: string }[];
}

export interface LocalPlanItem extends PlanItemBase {
  kind: 'local';
  /** ReviewComment.id */
  id: string;
  severity: CommentSeverity;
}

export type PlanItem = RemotePlanItem | LocalPlanItem;

/** Stable identity for toggle/dedupe/membership: `${kind}:${id}`. */
export function planItemKey(kind: PlanItem['kind'], id: string): string {
  return `${kind}:${id}`;
}

/** Value snapshot of a remote comment thread. */
export function snapshotRemote(
  thread: RemoteCommentThread,
  annotation?: string
): RemotePlanItem {
  const root = thread.comments[0];
  return {
    kind: 'remote',
    id: thread.id,
    file: thread.file,
    line: thread.lineStart,
    body: root?.body ?? '',
    author: root?.author ?? 'unknown',
    replies: thread.comments.slice(1).map((r) => ({
      author: r.author,
      body: r.body,
    })),
    ...(annotation ? { annotation } : {}),
  };
}

/** Value snapshot of a local draft comment. */
export function snapshotLocal(
  comment: ReviewComment,
  annotation?: string
): LocalPlanItem {
  return {
    kind: 'local',
    id: comment.id,
    file: comment.file,
    line: comment.lineStart,
    body: comment.body,
    severity: comment.severity,
    ...(annotation ? { annotation } : {}),
  };
}
