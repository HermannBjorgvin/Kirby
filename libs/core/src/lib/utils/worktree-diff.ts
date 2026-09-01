import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRef } from './diff-fetcher.js';
import { gitLine, runGit } from './git-run.js';

/**
 * What an agent has done to a worktree so far, committed or not.
 *
 * The review diff (`fetchDiffText`) compares two *commits*, which is
 * right for a pull request and useless for watching an agent work:
 * everything it has written since its last commit — usually everything
 * it has written at all — is invisible there. This runs inside the
 * worktree and diffs against the merge base instead, so the index and
 * the working tree are both included.
 *
 * Untracked files are assembled by hand rather than asked of git.
 * `git diff` cannot see them without `git add -N`, and writing to the
 * index of a worktree an agent is actively using is not something a
 * viewer should do — it changes what the agent's own `git status` and
 * `git commit` see. Files git ignores are never among them: the listing
 * is `--exclude-standard`, so a `node_modules` or a build directory
 * cannot arrive here however large it is.
 *
 * The work is bounded twice over, because whole-file context
 * (`-U99999`) makes a patch as large as the files it touches and one
 * generated file used to be enough to fail the whole tab with
 * "stdout maxBuffer length exceeded":
 *
 *   • Per file — anything binary, or bigger than `maxFileBytes`, is
 *     replaced by a one-line placeholder saying so. The rest of the
 *     diff renders normally, which is the point: one unrepresentable
 *     file must not cost the user the other forty.
 *   • Overall — every git call streams through `runGit` with an
 *     explicit ceiling instead of `execFile`'s fixed buffer, so hitting
 *     it truncates the patch at a file boundary and says so, rather
 *     than throwing away everything that had already arrived.
 */

export interface WorktreeDiffLimits {
  /** A file larger than this is summarised rather than diffed. */
  maxFileBytes: number;
  /** Ceiling on the whole patch. Generous: this is the backstop. */
  maxTotalBytes: number;
}

export const DEFAULT_WORKTREE_DIFF_LIMITS: WorktreeDiffLimits = {
  maxFileBytes: 2 * 1024 * 1024,
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

function megabytes(bytes: number): string {
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

export function tooLargeNote(bytes: number): string {
  return `file too large to diff, ${megabytes(bytes)}`;
}

export const BINARY_NOTE = 'binary file, not diffed';

async function mergeBase(
  worktreePath: string,
  targetBranch: string
): Promise<string> {
  const targetRef = await resolveRef(targetBranch);
  return gitLine(['merge-base', targetRef, 'HEAD'], { cwd: worktreePath });
}

interface ChangedFile {
  path: string;
  binary: boolean;
}

/**
 * Every path the tracked diff would cover, and whether git considers it
 * binary — asked for separately so the decision about what to render can
 * be made *before* the expensive whole-file diff runs.
 *
 * `--numstat -z` writes `adds\tdels\tpath\0`, with `-` for both counts on
 * a binary file. A rename writes an empty path in that record and
 * follows it with the old and new paths as two more records.
 */
export function parseNumstat(output: string): ChangedFile[] {
  const fields = output.split('\0');
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const parts = fields[i].split('\t');
    if (parts.length < 3) continue;
    const binary = parts[0] === '-' && parts[1] === '-';
    // A path may itself contain a tab, so everything past the two
    // counts is the path — splitting on the first one truncates it, and
    // the exclude pathspec built from it then names a file that does
    // not exist, so the oversized file is diffed after all.
    const path = parts.slice(2).join('\t');
    if (path === '') {
      // Rename or copy: the destination is the second following record.
      files.push({ path: fields[i + 2] ?? '', binary });
      i += 2;
    } else {
      files.push({ path, binary });
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
    maxBytes: 8 * 1024 * 1024,
  });
  return parseNumstat(text);
}

/** Size on disk, or null when the path is gone (a deletion, a race). */
async function sizeOf(path: string): Promise<number | null> {
  try {
    const s = await stat(path);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

interface Skipped {
  path: string;
  note: string;
}

/** Which changed files cannot be rendered, and what to say about them. */
async function skippedFiles(
  worktreePath: string,
  files: readonly ChangedFile[],
  limits: WorktreeDiffLimits
): Promise<Skipped[]> {
  const decided = await Promise.all(
    files.map(async (f): Promise<Skipped | null> => {
      if (f.binary) return { path: f.path, note: BINARY_NOTE };
      const size = await sizeOf(join(worktreePath, f.path));
      if (size !== null && size > limits.maxFileBytes) {
        return { path: f.path, note: tooLargeNote(size) };
      }
      return null;
    })
  );
  return decided.filter((s): s is Skipped => s !== null);
}

/**
 * Cut a patch back to its last complete file, so a truncated read never
 * hands the parser half a hunk (which it would render as real lines).
 */
export function trimToFileBoundary(patch: string): string {
  const cut = patch.lastIndexOf('\ndiff --git ');
  return cut === -1 ? '' : patch.slice(0, cut + 1);
}

async function trackedDiff(
  worktreePath: string,
  base: string,
  excluded: readonly Skipped[],
  limits: WorktreeDiffLimits
): Promise<string> {
  const { text, truncated } = await runGit(
    [
      'diff',
      '-U99999',
      base,
      '--',
      ...excluded.map((s) => `:(exclude,literal)${s.path}`),
    ],
    { cwd: worktreePath, maxBytes: limits.maxTotalBytes }
  );
  if (!truncated) return text;
  return (
    trimToFileBoundary(text) +
    placeholderPatch(
      'kirby/diff-truncated',
      `the diff exceeded ${megabytes(limits.maxTotalBytes)} and was cut short`
    )
  );
}

async function untrackedPaths(worktreePath: string): Promise<string[]> {
  const { text } = await runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: worktreePath, maxBytes: 8 * 1024 * 1024 }
  );
  return text.split('\0').filter(Boolean);
}

/**
 * Render one untracked file as an all-additions patch, in the shape
 * `git diff` would have produced had the file been added.
 */
export function untrackedFilePatch(path: string, content: string): string {
  const lines = content.split('\n');
  // A trailing newline splits into a final empty element that is not a
  // line of the file; without dropping it every new file gains a
  // phantom last line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const header =
    `diff --git a/${path} b/${path}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${path}\n`;
  if (lines.length === 0) return header;
  const body = lines.map((line) => `+${line}`).join('\n');
  return `${header}@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

/** Binary files have no useful patch, and NUL is the cheap tell. */
function looksBinary(content: string): boolean {
  return content.includes('\0');
}

async function untrackedFile(
  worktreePath: string,
  path: string,
  limits: WorktreeDiffLimits
): Promise<string> {
  try {
    const size = await sizeOf(join(worktreePath, path));
    if (size === null) return '';
    // Checked before reading: the point of the bound is not to pull a
    // hundred-megabyte file into memory to discover it is too big.
    if (size > limits.maxFileBytes) {
      return placeholderPatch(path, tooLargeNote(size));
    }
    const content = await readFile(join(worktreePath, path), 'utf8');
    if (looksBinary(content)) return placeholderPatch(path, BINARY_NOTE);
    return untrackedFilePatch(path, content);
  } catch {
    // Deleted between listing and reading, or unreadable: the next
    // poll will show whatever is true then.
    return '';
  }
}

async function untrackedDiff(
  worktreePath: string,
  limits: WorktreeDiffLimits
): Promise<string> {
  const paths = await untrackedPaths(worktreePath);
  const patches = await Promise.all(
    paths.map((path) => untrackedFile(worktreePath, path, limits))
  );
  return patches.join('');
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
  // output, and a placeholder as well would make it appear twice.
  const excluded = skipped.slice(0, MAX_EXCLUDE_PATHSPECS);
  const [tracked, untracked] = await Promise.all([
    trackedDiff(worktreePath, base, excluded, limits),
    untrackedDiff(worktreePath, limits),
  ]);
  const placeholders = excluded
    .map((s) => placeholderPatch(s.path, s.note))
    .join('');
  return tracked + placeholders + untracked;
}
