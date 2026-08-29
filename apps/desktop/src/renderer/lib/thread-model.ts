import type { RemoteCommentThread } from '../../host/contract.js';

/**
 * The decisions a review thread card makes about itself, apart from the
 * markup that shows them.
 */

/**
 * Whether the card is open.
 *
 * A resolved thread starts collapsed and an open one starts expanded,
 * but the user's own toggle beats both — until the card is (re)focused
 * by the thread navigator or the comment list, which clears the
 * override, so jumping to a comment always shows it. `override` is
 * therefore the answer whenever it has one, including `false`: having
 * collapsed a card by hand, the reader does not want it re-opening
 * because it happens to be unresolved.
 */
export function threadExpanded(
  override: boolean | null,
  focused: boolean,
  isResolved: boolean
): boolean {
  return override ?? (focused || !isResolved);
}

/**
 * "path/to/file.ts:12" for the card's location line — the full path,
 * unlike the comment list, which has a narrow rail and shows only the
 * basename. Null for a general PR comment, which is attached to no
 * file, and unsuffixed for a thread with no line.
 */
export function threadLocation(
  thread: Pick<RemoteCommentThread, 'file' | 'lineStart'>
): string | null {
  if (thread.file == null) return null;
  return `${thread.file}${
    thread.lineStart != null ? `:${thread.lineStart}` : ''
  }`;
}

/**
 * The one-line summary shown while a card is collapsed: the first line
 * of the body with anything in it, kept verbatim so its own indentation
 * survives. Empty when the body is blank.
 */
export function firstNonEmptyLine(body: string): string {
  return body.split('\n').find((l) => l.trim()) ?? '';
}
