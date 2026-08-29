import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export async function resolveRef(branch: string): Promise<string> {
  // Prefer remote tracking ref, fall back to local branch
  for (const candidate of [`origin/${branch}`, branch]) {
    try {
      await execFile('git', ['rev-parse', '--verify', candidate]);
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

  // `-U99999` asks for "whole file" context so review comments placed
  // on unmodified lines far from any hunk still render in-position
  // (see diff-fetcher.integration.spec.ts). The large context is a
  // deliberate product trade-off, not an oversight.
  const { stdout } = await execFile(
    'git',
    ['diff', '-U99999', `${targetRef}...${sourceRef}`],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  return stdout;
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
  const { stdout } = await execFile(
    'git',
    ['diff', '-U99999', `${targetRef}...${sourceRef}`, '--', filename],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  return stdout;
}
