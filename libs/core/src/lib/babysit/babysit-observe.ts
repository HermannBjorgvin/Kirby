/**
 * Reading a pull request for the babysitter: what the provider says
 * about its threads, and what git says about merging it.
 */
import type { AppConfig, PullRequestInfo, VcsProvider } from '@kirby/vcs-core';
import { countConflictsBetween, fetchBranches } from '@kirby/worktree-manager';
import {
  BABYSIT_REMOTE_REFRESH_MS,
  observeThread,
  type BabysitObservation,
  type BabysitThread,
} from './babysit-model.js';

/** The expensive half of an observation, reused between refreshes. */
export interface RemoteSnapshot {
  at: number;
  /** The list's unresolved count and head when the threads were read;
   *  either moving is reason to read them again early. */
  activeCommentCount: number | undefined;
  headSha: string | undefined;
  threads: BabysitThread[];
  fetched: boolean;
}

async function readThreads(
  pr: PullRequestInfo,
  provider: VcsProvider | null,
  config: AppConfig
): Promise<BabysitThread[]> {
  if (!provider?.fetchCommentThreads) return [];
  const isOwn = (author: string) => provider.matchesUser(author, config);
  const comments = await provider.fetchCommentThreads(
    config.vendorAuth,
    config.vendorProject,
    pr.id
  );
  return [...comments.threads, ...comments.generalComments]
    .filter((t) => !t.isResolved)
    .map((t) => observeThread(t, isOwn));
}

function remoteIsFresh(
  previous: RemoteSnapshot | null,
  pr: PullRequestInfo,
  now: number,
  refreshMs: number
): previous is RemoteSnapshot {
  return (
    previous !== null &&
    now - previous.at < refreshMs &&
    previous.activeCommentCount === pr.activeCommentCount &&
    previous.headSha === pr.headSha
  );
}

/**
 * One poll's worth of facts about the pull request. The provider's
 * thread list and the git fetch are the expensive part and run on
 * their own cadence, or early when the cached list shows the count or
 * the head moved; the merge check runs every time against whatever
 * the tracking refs hold.
 */
export async function observePullRequest(
  pr: PullRequestInfo,
  provider: VcsProvider | null,
  config: AppConfig,
  previous: RemoteSnapshot | null,
  now: number,
  refreshMs = BABYSIT_REMOTE_REFRESH_MS
): Promise<{ observation: BabysitObservation; remote: RemoteSnapshot }> {
  const remote = remoteIsFresh(previous, pr, now, refreshMs)
    ? previous
    : {
        at: now,
        activeCommentCount: pr.activeCommentCount,
        headSha: pr.headSha,
        threads: await readThreads(pr, provider, config),
        fetched: await fetchBranches([pr.targetBranch, pr.sourceBranch]),
      };
  const conflictCount = remote.fetched
    ? await countConflictsBetween(
        `origin/${pr.targetBranch}`,
        `origin/${pr.sourceBranch}`
      )
    : null;
  return {
    observation: {
      buildStatus: pr.buildStatus,
      headSha: pr.headSha,
      threads: remote.threads,
      conflictCount,
    },
    remote,
  };
}
