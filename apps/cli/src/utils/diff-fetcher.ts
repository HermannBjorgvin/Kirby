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

export async function fetchDiffText(
  sourceBranch: string,
  targetBranch: string
): Promise<string> {
  const [sourceRef, targetRef] = await Promise.all([
    resolveRef(sourceBranch),
    resolveRef(targetBranch),
  ]);

  const { stdout } = await execFile(
    'git',
    ['diff', '-U99999', `${targetRef}...${sourceRef}`],
    { maxBuffer: 50 * 1024 * 1024 }
  );
  return stdout;
}
