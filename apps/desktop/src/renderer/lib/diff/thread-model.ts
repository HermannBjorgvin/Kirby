import type { RemoteCommentThread } from '../../../host/contract.js';

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

/**
 * What the composer says about comments that landed while it was
 * opening.
 *
 * Opening a reply box kicks off a refetch of the pull request's
 * threads, because the poll that last filled the cache may be half a
 * minute old and the thing worth knowing before you type is that
 * somebody already answered. The card re-renders with whatever comes
 * back on its own; this is the part the reader would otherwise miss —
 * that the thread grew *just now*, under a composer they had already
 * opened.
 *
 * `baseline` is the comment count captured when the composer opened.
 * A thread that shrank (a comment deleted upstream) reports nothing:
 * there is no new comment to read, and "-1 new comments" is worse than
 * silence.
 *
 * The two notices are told apart by `kind` rather than by their words,
 * because they are not the same claim — one is progress and reads as
 * muted chrome, the other is news and has to be noticed.
 */
export interface ComposerNotice {
  kind: 'checking' | 'arrived';
  text: string;
}

export function composerRefreshNotice(opts: {
  checking: boolean;
  baseline: number | null;
  current: number;
}): ComposerNotice | null {
  if (opts.checking)
    return { kind: 'checking', text: 'Checking for new comments…' };
  if (opts.baseline == null) return null;
  const arrived = opts.current - opts.baseline;
  if (arrived <= 0) return null;
  return {
    kind: 'arrived',
    text:
      arrived === 1
        ? '1 new comment arrived — read it before replying.'
        : `${arrived} new comments arrived — read them before replying.`,
  };
}

/**
 * Every comment on the pull request, threads and conversation alike.
 *
 * The freshness baseline for a composer that is not attached to one
 * thread — the draft editor, where the news worth having is that
 * *anything* landed on the request, not that this particular thread
 * grew.
 */
export function totalCommentCount(
  comments:
    | { threads: RemoteCommentThread[]; generalComments: RemoteCommentThread[] }
    | undefined
): number {
  if (!comments) return 0;
  return [...comments.threads, ...comments.generalComments].reduce(
    (sum, t) => sum + t.comments.length,
    0
  );
}
