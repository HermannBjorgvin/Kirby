import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { placeholderPatch, megabytes } from './diff-patch.js';
import { runGit } from './git-run.js';

/**
 * Files an agent has written but not added, as patches.
 *
 * `git diff` cannot see an untracked file without `git add -N`, and
 * writing to the index of a worktree an agent is actively using is not
 * something a viewer should do — it changes what the agent's own `git
 * status` and `git commit` see. So the patches are assembled by hand.
 *
 * The listing is `--exclude-standard`, so a `node_modules` or a build
 * directory git ignores never appears here however large it is.
 */

export const BINARY_NOTE = 'binary file, not diffed';

export function tooLargeNote(bytes: number): string {
  return `file too large to diff, ${megabytes(bytes)}`;
}

/** Files read at once. An agent can leave a build directory's worth of
 *  new files behind, and reading a few hundred of them concurrently at
 *  megabytes each — every two seconds — is both a memory spike and a
 *  way to run out of file descriptors. */
const READ_CONCURRENCY = 8;

/** Listing bytes, not file bytes: enough for ~half a million paths. */
const MAX_LISTING_BYTES = 8 * 1024 * 1024;

/**
 * Render one untracked file as an all-additions patch, in the shape
 * `git diff` would have produced had the file been added.
 */
export function untrackedFilePatch(
  path: string,
  content: string,
  mode = '100644'
): string {
  const lines = content.split('\n');
  // A trailing newline splits into a final empty element that is not a
  // line of the file; without dropping it every new file gains a
  // phantom last line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const header =
    `diff --git a/${path} b/${path}\n` +
    `new file mode ${mode}\n` +
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

async function untrackedPaths(worktreePath: string): Promise<string[]> {
  const { text } = await runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: worktreePath, maxBytes: MAX_LISTING_BYTES }
  );
  return text.split('\0').filter(Boolean);
}

async function onePatch(
  worktreePath: string,
  path: string,
  maxFileBytes: number
): Promise<string> {
  const full = join(worktreePath, path);
  try {
    // `lstat`, not `stat`: a symlink is a link, and following one would
    // both size it as its target and — below — print a file from
    // outside the repository as if the agent had written it here. git
    // renders a symlink as the target *path*, mode 120000.
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      return untrackedFilePatch(path, `${await readlink(full)}\n`, '120000');
    }
    if (!info.isFile()) return '';
    // Checked before reading: the point of the bound is not to pull a
    // hundred-megabyte file into memory to discover it is too big.
    if (info.size > maxFileBytes) {
      return placeholderPatch(path, tooLargeNote(info.size));
    }
    const content = await readFile(full, 'utf8');
    if (looksBinary(content)) return placeholderPatch(path, BINARY_NOTE);
    return untrackedFilePatch(path, content);
  } catch {
    // Deleted between listing and reading, or unreadable: the next poll
    // will show whatever is true then.
    return '';
  }
}

export async function untrackedDiff(
  worktreePath: string,
  maxFileBytes: number
): Promise<string> {
  const paths = await untrackedPaths(worktreePath);
  const patches: string[] = [];
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const batch = paths.slice(i, i + READ_CONCURRENCY);
    patches.push(
      ...(await Promise.all(
        batch.map((path) => onePatch(worktreePath, path, maxFileBytes))
      ))
    );
  }
  return patches.join('');
}
