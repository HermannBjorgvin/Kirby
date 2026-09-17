import { basename } from 'node:path';
import type { WorktreeInfo } from '@n10/worktree-manager';
import { getRepoRoot } from './repo-root.js';

export type SessionIdentity =
  | { kind: 'worktree'; repo: string; branch: string }
  | { kind: 'terminal'; id: string };

/** Opaque internal keys. JSON tuples keep punctuation and namespaces distinct. */
export function worktreeSessionKey(
  branch: string,
  repo = getRepoRoot() ?? process.cwd()
): string {
  return JSON.stringify(['worktree', repo, branch]);
}

export function terminalSessionKey(id: string): string {
  return JSON.stringify(['terminal', id]);
}

export function sessionIdentity(key: string): SessionIdentity | null {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value)) return null;
    if (
      value.length === 2 &&
      value[0] === 'terminal' &&
      typeof value[1] === 'string'
    )
      return { kind: 'terminal', id: value[1] };
    if (
      value.length === 3 &&
      value[0] === 'worktree' &&
      typeof value[1] === 'string' &&
      typeof value[2] === 'string'
    )
      return { kind: 'worktree', repo: value[1], branch: value[2] };
  } catch {
    /* An arbitrary label is not an identity. */
  }
  return null;
}

/** Display text is never used to address a registry entry. */
export function sessionLabel(key: string): string {
  const id = sessionIdentity(key);
  return id?.kind === 'worktree' ? id.branch : id?.id ?? key;
}

export function keyForWorktree(
  wt: Pick<WorktreeInfo, 'branch' | 'path'>,
  repo?: string
): string {
  return worktreeSessionKey(wt.branch || basename(wt.path), repo);
}
