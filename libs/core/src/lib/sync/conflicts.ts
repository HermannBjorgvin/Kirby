/**
 * Whether a branch still merges into what it is for.
 *
 * One predicate for the sidebar badge and the babysitter, so the two
 * cannot disagree about the same branch. A branch with a pull request
 * is judged on the remote side — `origin/<target>` against
 * `origin/<source>` — because that is what the request will merge, and
 * the local branch may not be where the author pushed. A branch with
 * no pull request has nothing on the remote to be judged against and
 * is compared locally with origin's main branch.
 */
import type { PullRequestInfo } from '@kirby/vcs-core';
import { countConflicts, countConflictsBetween } from '@kirby/worktree-manager';

/** Files that conflict with the pull request's target, or null when
 *  the check could not run — the tracking refs are not fetched, or
 *  the source lives on a fork. */
export function countPullRequestConflicts(
  pr: Pick<PullRequestInfo, 'sourceBranch' | 'targetBranch'>,
  cwd?: string
): Promise<number | null> {
  return countConflictsBetween(
    `origin/${pr.targetBranch}`,
    `origin/${pr.sourceBranch}`,
    cwd
  );
}

/** The count for a branch, by whichever comparison applies to it.
 *  A check that could not run counts 0: the badge shows conflicts,
 *  not doubt. */
export async function countBranchConflicts(
  branch: string,
  pr: Pick<PullRequestInfo, 'sourceBranch' | 'targetBranch'> | undefined
): Promise<number> {
  if (pr) return (await countPullRequestConflicts(pr)) ?? 0;
  return countConflicts(branch);
}
