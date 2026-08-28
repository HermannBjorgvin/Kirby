import { execFile as execFileCb } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveRef } from './diff-fetcher.js';

const execFile = promisify(execFileCb);

const MAX_BUFFER = 50 * 1024 * 1024;

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
 * `git commit` see.
 */

/** Files whose contents are not worth (or safe to) render as a diff. */
const MAX_UNTRACKED_BYTES = 512 * 1024;

async function mergeBase(
  worktreePath: string,
  targetBranch: string
): Promise<string> {
  const targetRef = await resolveRef(targetBranch);
  const { stdout } = await execFile('git', ['merge-base', targetRef, 'HEAD'], {
    cwd: worktreePath,
  });
  return stdout.trim();
}

async function trackedDiff(
  worktreePath: string,
  base: string
): Promise<string> {
  const { stdout } = await execFile('git', ['diff', '-U99999', base], {
    cwd: worktreePath,
    maxBuffer: MAX_BUFFER,
  });
  return stdout;
}

async function untrackedPaths(worktreePath: string): Promise<string[]> {
  const { stdout } = await execFile(
    'git',
    ['ls-files', '--others', '--exclude-standard', '-z'],
    { cwd: worktreePath, maxBuffer: MAX_BUFFER }
  );
  return stdout.split('\0').filter(Boolean);
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

async function untrackedDiff(worktreePath: string): Promise<string> {
  const paths = await untrackedPaths(worktreePath);
  const patches = await Promise.all(
    paths.map(async (path) => {
      try {
        const buf = await readFile(join(worktreePath, path));
        if (buf.byteLength > MAX_UNTRACKED_BYTES) return '';
        const content = buf.toString('utf8');
        if (looksBinary(content)) return '';
        return untrackedFilePatch(path, content);
      } catch {
        // Deleted between listing and reading, or unreadable: the next
        // poll will show whatever is true then.
        return '';
      }
    })
  );
  return patches.join('');
}

/**
 * Diff of a worktree against the branch it will merge into, including
 * uncommitted and untracked work.
 */
export async function fetchWorktreeDiffText(
  worktreePath: string,
  targetBranch: string
): Promise<string> {
  const base = await mergeBase(worktreePath, targetBranch);
  const [tracked, untracked] = await Promise.all([
    trackedDiff(worktreePath, base),
    untrackedDiff(worktreePath),
  ]);
  return tracked + untracked;
}
