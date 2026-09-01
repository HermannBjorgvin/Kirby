/**
 * Patch text the app writes itself, rather than getting from git.
 *
 * Both diff paths need to say something about a file they cannot show,
 * and both need to cut an over-long patch somewhere safe. Shared here so
 * the two never drift, and so `diff-fetcher` does not have to import
 * from `worktree-diff`, which imports back from it.
 */

export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A file the viewer is told about but cannot show, as a patch.
 *
 * It has to *be* a patch: the tree, the file list and the counts are all
 * built from the parsed diff, so a file omitted outright simply is not
 * there, and the user has no way to tell "unchanged" from "too big to
 * render".
 */
export function placeholderPatch(path: string, note: string): string {
  return (
    `diff --git a/${path} b/${path}\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    `@@ -0,0 +1,1 @@\n` +
    `+${note}\n`
  );
}

/** The path a truncation notice is filed under, so it sorts out of the way
 *  and cannot collide with a real file. */
const TRUNCATED_PATH = 'kirby/diff-truncated';

export function truncationPatch(limitBytes: number): string {
  return placeholderPatch(
    TRUNCATED_PATH,
    `the diff exceeded ${megabytes(limitBytes)} and was cut short`
  );
}

/**
 * Cut a patch back to its last complete file, so a truncated read never
 * hands the parser half a hunk (which it would render as real lines).
 */
export function trimToFileBoundary(patch: string): string {
  const cut = patch.lastIndexOf('\ndiff --git ');
  return cut === -1 ? '' : patch.slice(0, cut + 1);
}

/** Whatever of `text` is safe to parse, plus a notice when it was cut. */
export function completePatch(
  text: string,
  truncated: boolean,
  limitBytes: number
): string {
  if (!truncated) return text;
  return trimToFileBoundary(text) + truncationPatch(limitBytes);
}
