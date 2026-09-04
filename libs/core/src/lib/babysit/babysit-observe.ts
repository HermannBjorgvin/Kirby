/**
 * Reading a pull request for the babysitter: what the provider says
 * about its threads, and what git says about merging it.
 *
 * Every git call names the repository it is about. The watcher
 * outlives the desktop's `chdir` between repositories, so a call that
 * resolved the process's directory at the moment it ran would fetch,
 * and judge conflicts, in whichever checkout happened to be open.
 */
import type { AppConfig, PullRequestInfo, VcsProvider } from '@kirby/vcs-core';
import { countPullRequestConflicts } from '../sync/conflicts.js';
import { fetchRefs } from '../sync/fetch-queue.js';
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

export interface ObserveOptions {
  pr: PullRequestInfo;
  provider: VcsProvider | null;
  config: AppConfig;
  /** The repository the pull request belongs to. */
  cwd: string;
  previous: RemoteSnapshot | null;
  now: number;
  refreshMs?: number;
  /** Asked between steps; false abandons the observation — the watch
   *  was stopped, or the repository it is about is no longer the one
   *  the shell is on, and its branch names mean nothing there. */
  live?: () => boolean;
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

/** The provider's threads and a fetch of both refs. Null when the
 *  observation was abandoned between the two. The fetch waits its turn
 *  behind any other fetch of the repository, and a fetch of the same
 *  refs younger than the refresh interval is reused rather than
 *  repeated. */
async function refreshRemote(
  opts: ObserveOptions,
  refreshMs: number,
  live: () => boolean
): Promise<RemoteSnapshot | null> {
  const { pr, provider, config, cwd, now } = opts;
  const threads = await readThreads(pr, provider, config);
  if (!live()) return null;
  const fetched = await fetchRefs({
    cwd,
    refs: [pr.targetBranch, pr.sourceBranch],
    maxAgeMs: refreshMs,
  });
  if (!live()) return null;
  return {
    at: now,
    activeCommentCount: pr.activeCommentCount,
    headSha: pr.headSha,
    threads,
    fetched,
  };
}

/**
 * One poll's worth of facts about the pull request. The provider's
 * thread list and the git fetch are the expensive part and run on
 * their own cadence, or early when the cached list shows the count or
 * the head moved; the merge check runs every time against whatever
 * the tracking refs hold. Null when abandoned: no git runs after
 * `live` has said no.
 */
export async function observePullRequest(
  opts: ObserveOptions
): Promise<{ observation: BabysitObservation; remote: RemoteSnapshot } | null> {
  const { pr, cwd, previous, now, live = () => true } = opts;
  const refreshMs = opts.refreshMs ?? BABYSIT_REMOTE_REFRESH_MS;
  const remote = remoteIsFresh(previous, pr, now, refreshMs)
    ? previous
    : await refreshRemote(opts, refreshMs, live);
  if (!remote) return null;
  const conflictCount = remote.fetched
    ? await countPullRequestConflicts(pr, cwd)
    : null;
  if (!live()) return null;
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
