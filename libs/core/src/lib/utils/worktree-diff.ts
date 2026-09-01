import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRef } from './diff-fetcher.js';
import { completePatch, placeholderPatch } from './diff-patch.js';
import { gitLine, runGit } from './git-run.js';
import { BINARY_NOTE, tooLargeNote, untrackedDiff } from './untracked-diff.js';

export { untrackedFilePatch, BINARY_NOTE } from './untracked-diff.js';

/**
 * What an agent has done to a worktree so far, committed or not.
 *
 * The review diff (`fetchDiffText`) compares two *commits*, which is
 * right for a pull request and useless for watching an agent work:
 * everything it has written since its last commit — usually everything
 * it has written at all — is invisible there. This runs inside the
 * worktree and diffs against the merge base instead, so the index and
 * the working tree are both included, with untracked files assembled by
 * hand (`untracked-diff.ts`).
 *
 * The work is bounded twice over, because whole-file context
 * (`-U99999`) makes a patch as large as the files it touches and one
 * generated file used to be enough to fail the whole tab with
 * "stdout maxBuffer length exceeded":
 *
 *   • Per file — anything binary, or big enough that its patch would
 *     dominate the diff, is replaced by a one-line placeholder saying
 *     so. The rest of the diff renders normally, which is the point:
 *     one unrepresentable file must not cost the user the other forty.
 *   • Overall — every git call streams through `runGit` with an
 *     explicit ceiling instead of `execFile`'s fixed buffer, so hitting
 *     it truncates the patch at a file boundary and says so, rather
 *     than throwing away everything that had already arrived.
 */

export interface WorktreeDiffLimits {
  /** A file on disk larger than this is summarised rather than diffed. */
  maxFileBytes: number;
  /**
   * Churn past which a file is summarised instead. The size bound above
   * cannot see a deletion — there is nothing left on disk to measure —
   * and with `-U99999` a deleted file's patch is the whole file.
   */
  maxFileLines: number;
  /** Ceiling on the whole patch. Generous: this is the backstop. */
  maxTotalBytes: number;
}

export const DEFAULT_WORKTREE_DIFF_LIMITS: WorktreeDiffLimits = {
  maxFileBytes: 2 * 1024 * 1024,
  maxFileLines: 50_000,
  maxTotalBytes: 128 * 1024 * 1024,
};

/**
 * How many files may be named as `:(exclude)` pathspecs. Every skipped
 * file costs an argv entry, and a diff that touches thousands of binary
 * assets would otherwise hit ARG_MAX and fail for a reason that has
 * nothing to do with the user. Past this the rest are diffed as they
 * come and the overall ceiling does the bounding — and they get no
 * placeholder either, since they are still in git's own output.
 */
const MAX_EXCLUDE_PATHSPECS = 500;

/** Listing bytes, not file bytes: enough for ~half a million paths. */
const MAX_LISTING_BYTES = 8 * 1024 * 1024;

export function tooManyLinesNote(lines: number): string {
  return `file too large to diff, ${lines.toLocaleString('en-US')} changed lines`;
}

async function mergeBase(
  worktreePath: string,
  targetBranch: string
): Promise<string> {
  const targetRef = await resolveRef(targetBranch);
  return gitLine(['merge-base', targetRef, 'HEAD'], { cwd: worktreePath });
}

export interface ChangedFile {
  path: string;
  /** Where a rename or copy came from; absent otherwise. */
  oldPath?: string;
  binary: boolean;
  adds: number;
  dels: number;
}

/**
 * Every path the tracked diff would cover, with the churn git counted
 * and whether it calls the file binary — asked for separately so the
 * decision about what to render can be made *before* the expensive
 * whole-file diff runs.
 *
 * `--numstat -z` writes `adds\tdels\tpath\0`, with `-` for both counts
 * on a binary file. A rename or copy writes an empty path in that
 * record and follows it with the old and new paths as two more
 * records, old first.
 */
export function parseNumstat(output: string): ChangedFile[] {
  const fields = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const parts = fields[i].split('\t');
    if (parts.length < 3) continue;
    const binary = parts[0] === '-' && parts[1] === '-';
    const adds = binary ? 0 : Number(parts[0]);
    const dels = binary ? 0 : Number(parts[1]);
    // A path may itself contain a tab, so everything past the two
    // counts is the path — splitting on the first one truncates it, and
    // the exclude pathspec built from it then names a file that does
    // not exist, so the oversized file is diffed after all.
    const path = parts.slice(2).join('\t');
    if (path === '') {
      files.push({
        path: fields[i + 2] ?? '',
        oldPath: fields[i + 1] ?? '',
        binary,
        adds,
        dels,
      });
      i += 2;
    } else {
      files.push({ path, binary, adds, dels });
    }
  }
  return files.filter((f) => f.path !== '');
}

async function changedFiles(
  worktreePath: string,
  base: string
): Promise<ChangedFile[]> {
  const { text } = await runGit(['diff', '--numstat', '-z', base], {
    cwd: worktreePath,
    maxBytes: MAX_LISTING_BYTES,
  });
  return parseNumstat(text);
}

/** Size of the path itself, following no symlink; null when it is gone. */
async function sizeOf(path: string): Promise<number | null> {
  try {
    const info = await lstat(path);
    // A symlink's own size is the length of its target path, which is
    // also all git renders for it. Following it would size the link as
    // whatever it points at, somewhere else entirely.
    return info.isFile() || info.isSymbolicLink() ? info.size : null;
  } catch {
    return null;
  }
}

interface Skipped {
  /** The file the placeholder speaks for. */
  path: string;
  /** Every path that must leave git's output for that to be true. */
  exclude: string[];
  note: string;
}

async function skipReason(
  worktreePath: string,
  f: ChangedFile,
  limits: WorktreeDiffLimits
): Promise<string | null> {
  if (f.binary) return BINARY_NOTE;
  // A pure rename or mode change carries no content at all — git emits
  // a header and stops. Excluding one would be worse than useless:
  // pathspecs are applied before rename detection, so the surviving
  // side comes back unpaired, as a whole-file deletion.
  if (f.adds === 0 && f.dels === 0) return null;
  const size = await sizeOf(join(worktreePath, f.path));
  if (size !== null && size > limits.maxFileBytes) return tooLargeNote(size);
  // Nothing on disk to measure (a deletion), or a file that shrank to
  // nothing: the churn git counted is what the patch will cost.
  const churn = f.adds + f.dels;
  if (churn > limits.maxFileLines) return tooManyLinesNote(churn);
  return null;
}

/** Which changed files cannot be rendered, and what to say about them. */
async function skippedFiles(
  worktreePath: string,
  files: readonly ChangedFile[],
  limits: WorktreeDiffLimits
): Promise<Skipped[]> {
  const decided = await Promise.all(
    files.map(async (f): Promise<Skipped | null> => {
      const note = await skipReason(worktreePath, f, limits);
      if (note === null) return null;
      // Both sides of a rename, or git pairs the surviving one with
      // nothing and renders it whole.
      const exclude = f.oldPath ? [f.path, f.oldPath] : [f.path];
      return { path: f.path, exclude, note };
    })
  );
  return decided.filter((s): s is Skipped => s !== null);
}

async function trackedDiff(
  worktreePath: string,
  base: string,
  excluded: readonly Skipped[],
  limits: WorktreeDiffLimits
): Promise<string> {
  const pathspecs = excluded
    .flatMap((s) => s.exclude)
    .map((path) => `:(exclude,literal)${path}`);
  const { text, truncated } = await runGit(
    ['diff', '-U99999', base, '--', ...pathspecs],
    { cwd: worktreePath, maxBytes: limits.maxTotalBytes }
  );
  return completePatch(text, truncated, limits.maxTotalBytes);
}

/**
 * Diff of a worktree against the branch it will merge into, including
 * uncommitted and untracked work.
 */
export async function fetchWorktreeDiffText(
  worktreePath: string,
  targetBranch: string,
  limits: WorktreeDiffLimits = DEFAULT_WORKTREE_DIFF_LIMITS
): Promise<string> {
  const base = await mergeBase(worktreePath, targetBranch);
  const skipped = await skippedFiles(
    worktreePath,
    await changedFiles(worktreePath, base),
    limits
  );
  // Only what is actually kept out of the diff may be represented by a
  // placeholder: past the pathspec cap the file is still in git's own
  // output, and a placeholder as well would list it twice.
  const excluded = skipped.slice(0, MAX_EXCLUDE_PATHSPECS);
  const [tracked, untracked] = await Promise.all([
    trackedDiff(worktreePath, base, excluded, limits),
    untrackedDiff(worktreePath, limits.maxFileBytes),
  ]);
  const placeholders = excluded
    .map((s) => placeholderPatch(s.path, s.note))
    .join('');
  return tracked + placeholders + untracked;
}
