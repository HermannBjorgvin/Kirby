import { gitLine, runGit } from './git-run.js';

/**
 * Ceiling on a review diff.
 *
 * `-U99999` asks for "whole file" context so review comments placed on
 * unmodified lines far from any hunk still render in-position (see
 * diff-fetcher.integration.spec.ts). The large context is a deliberate
 * product trade-off, so the payload is as big as the pull request's
 * files — and it streams through `runGit` rather than `execFile` for the
 * same reason the worktree diff does: `execFile` discards everything it
 * read when the buffer is exceeded, which turns a big pull request into
 * "stdout maxBuffer length exceeded" and an empty tab.
 *
 * Unlike the worktree diff this does not drop oversized files. A pull
 * request is a document under review and its comments anchor into it;
 * quietly leaving a file out of what a reviewer is reading is worse
 * than a long parse.
 */
const MAX_DIFF_BYTES = 256 * 1024 * 1024;

export async function resolveRef(branch: string): Promise<string> {
  // Prefer remote tracking ref, fall back to local branch
  for (const candidate of [`origin/${branch}`, branch]) {
    try {
      await gitLine(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`Cannot resolve ref for branch: ${branch}`);
}

async function resolveBoth(
  sourceBranch: string,
  targetBranch: string,
  preResolved?: { sourceRef: string; targetRef: string }
): Promise<{ sourceRef: string; targetRef: string }> {
  if (preResolved) return preResolved;
  const [sourceRef, targetRef] = await Promise.all([
    resolveRef(sourceBranch),
    resolveRef(targetBranch),
  ]);
  return { sourceRef, targetRef };
}

export async function fetchDiffText(
  sourceBranch: string,
  targetBranch: string,
  preResolved?: { sourceRef: string; targetRef: string }
): Promise<string> {
  const { sourceRef, targetRef } = await resolveBoth(
    sourceBranch,
    targetBranch,
    preResolved
  );

  const { text } = await runGit(
    ['diff', '-U99999', `${targetRef}...${sourceRef}`],
    { maxBytes: MAX_DIFF_BYTES }
  );
  return text;
}

// Per-file diff — used by the diff viewer on file open. Scoping to a
// single file drops the payload from whole-PR (multi-MB) to kilobytes,
// so the viewer renders immediately instead of waiting on git to
// stream the full PR. `-U99999` still gives whole-file context so
// comments placed on unchanged lines resolve correctly.
export async function fetchFileDiffText(
  sourceBranch: string,
  targetBranch: string,
  filename: string,
  preResolved?: { sourceRef: string; targetRef: string }
): Promise<string> {
  const { sourceRef, targetRef } = await resolveBoth(
    sourceBranch,
    targetBranch,
    preResolved
  );
  const { text } = await runGit(
    ['diff', '-U99999', `${targetRef}...${sourceRef}`, '--', filename],
    { maxBytes: MAX_DIFF_BYTES }
  );
  return text;
}
