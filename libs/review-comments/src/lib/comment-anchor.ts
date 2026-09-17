import type { ReviewComment } from './types.js';

/** Where a draft sits: on lines, on a file, or on the pull request. */
export type CommentAnchor = 'line' | 'file' | 'pr';

export type AnchorFields = Pick<
  ReviewComment,
  'file' | 'lineStart' | 'lineEnd'
>;

export function commentAnchor(c: AnchorFields): CommentAnchor {
  if (c.file == null) return 'pr';
  if (c.lineStart == null || c.lineEnd == null) return 'file';
  return 'line';
}

/**
 * The location a reader sees next to a draft: `src/a.ts:10-12`,
 * `src/a.ts`, or the word for the pull request's own conversation.
 */
export function describeAnchor(c: AnchorFields): string {
  const anchor = commentAnchor(c);
  if (anchor === 'pr') return 'Conversation';
  if (anchor === 'file') return c.file!;
  return c.lineStart === c.lineEnd
    ? `${c.file}:${c.lineStart}`
    : `${c.file}:${c.lineStart}-${c.lineEnd}`;
}
