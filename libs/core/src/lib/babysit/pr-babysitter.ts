/**
 * Watching a pull request on an agent's behalf.
 *
 * "Babysit" on a pull request means: keep an eye on its CI, its
 * unresolved review threads and whether it still merges cleanly into
 * its target, and when something needs doing, tell the agent working
 * on it — once, in one message, after the news has stopped changing,
 * and only while the agent is idle. An agent mid-task is not
 * interrupted; the update waits for it.
 *
 * The rules about what is news and when it is quiet enough to send are
 * `babysit-model.ts`'s. This file owns the loop: polling, the git and
 * provider calls that make an observation, and delivery through the
 * same paths every other prompt takes — typed into a live session, or
 * a session started in the pull request's worktree when there is none.
 * Both shells drive it; the desktop adds only its session bookkeeping.
 */
import { logError } from '@kirby/logger';
import type { AppConfig, PullRequestInfo, VcsProvider } from '@kirby/vcs-core';
import {
  branchToSessionName,
  countRemoteConflicts,
  createWorktree,
} from '@kirby/worktree-manager';
import { snapshot } from '../activity.js';
import { isSessionAlive } from '../pty-registry.js';
import {
  deliverToRunningSession,
  launchSession,
} from '../session/launch-session.js';
import {
  BABYSIT_POLL_MS,
  initialBabysitState,
  isDue,
  observe,
  observeThread,
  takeReport,
  type BabysitObservation,
  type BabysitState,
  type DeliveryTiming,
} from './babysit-model.js';
import { composeBabysitPrompt } from './babysit-prompt.js';

export interface BabysitStatus {
  prId: number;
  sourceBranch: string;
  /** `pending`: an update is waiting to be sent. `ended`: the pull
   *  request is gone (merged or closed) and watching has stopped. */
  phase: 'watching' | 'pending' | 'ended';
  lastPolledAt: number | null;
  pendingSince: number | null;
  lastDeliveredAt: number | null;
  deliveries: number;
  lastError: string | null;
}

export interface PrBabysitterOptions {
  pr: PullRequestInfo;
  provider: VcsProvider | null;
  /** Read per poll, so a credential change takes effect. */
  getConfig: () => AppConfig;
  /** The pull request as the provider has it now, or null once it is
   *  merged or closed — at which point there is nothing left to watch. */
  readPullRequest: () => Promise<PullRequestInfo | null>;
  /** Grid for an agent started because none was running. */
  paneSize: () => { cols: number; rows: number };
  /** A session was started in `cwd` to receive the update. The
   *  desktop attaches its output relay here. */
  onSpawned?: (name: string, cwd: string) => void;
  onStatus: (status: BabysitStatus) => void;
  intervalMs?: number;
  timing?: DeliveryTiming;
  /** Returning false skips a tick — the desktop can have another
   *  repository open, and this one's branch names mean nothing there. */
  isCurrent?: () => boolean;
  now?: () => number;
}

export interface PrBabysitter {
  /** Poll now rather than at the next tick. Resolves when the poll,
   *  and any delivery it led to, has finished. */
  pollNow(): Promise<void>;
  status(): BabysitStatus;
  /** Stop watching. Idempotent. */
  stop(): void;
}

type DeliveryOutcome = 'injected' | 'spawned' | 'busy' | 'failed';

/** One poll's worth of facts about the pull request. */
export async function observePullRequest(
  pr: PullRequestInfo,
  provider: VcsProvider | null,
  config: AppConfig
): Promise<BabysitObservation> {
  const isOwn = (author: string) =>
    provider?.matchesUser(author, config) ?? false;
  const comments = provider?.fetchCommentThreads
    ? await provider.fetchCommentThreads(
        config.vendorAuth,
        config.vendorProject,
        pr.id
      )
    : { threads: [], generalComments: [] };
  const threads = [...comments.threads, ...comments.generalComments]
    .filter((t) => !t.isResolved)
    .map((t) => observeThread(t, isOwn));
  const conflictCount = await countRemoteConflicts(
    pr.sourceBranch,
    pr.targetBranch
  );
  return { buildStatus: pr.buildStatus, threads, conflictCount };
}

/**
 * Hand the update to the agent: typed into its session when one is
 * running and idle, or as the opening prompt of a new one. Continues
 * the worktree's previous conversation where the agent supports it, so
 * an agent that already worked on this pull request picks up with what
 * it knows.
 */
async function deliver(
  opts: PrBabysitterOptions,
  pr: PullRequestInfo,
  prompt: string
): Promise<DeliveryOutcome> {
  const name = branchToSessionName(pr.sourceBranch);
  if (isSessionAlive(name)) {
    if (snapshot(name).active) return 'busy';
    return deliverToRunningSession(name, prompt) ? 'injected' : 'failed';
  }
  const cwd = await createWorktree(pr.sourceBranch);
  if (!cwd) return 'failed';
  const { cols, rows } = opts.paneSize();
  launchSession({
    name,
    cwd,
    cols,
    rows,
    config: opts.getConfig(),
    request: { intent: 'continue-or-seed', prompt },
  });
  opts.onSpawned?.(name, cwd);
  return 'spawned';
}

export function startPrBabysitter(opts: PrBabysitterOptions): PrBabysitter {
  const { onStatus, isCurrent = () => true, now = Date.now } = opts;
  const intervalMs = opts.intervalMs ?? BABYSIT_POLL_MS;
  let pr = opts.pr;
  let state: BabysitState = initialBabysitState();
  let status: BabysitStatus = {
    prId: pr.id,
    sourceBranch: pr.sourceBranch,
    phase: 'watching',
    lastPolledAt: null,
    pendingSince: null,
    lastDeliveredAt: null,
    deliveries: 0,
    lastError: null,
  };
  let stopped = false;
  let tail: Promise<void> = Promise.resolve();

  const publish = (patch: Partial<BabysitStatus>) => {
    const ended = status.phase === 'ended' || patch.phase === 'ended';
    const phase = state.pendingSince === null ? 'watching' : 'pending';
    status = {
      ...status,
      ...patch,
      pendingSince: state.pendingSince,
      phase: ended ? 'ended' : phase,
    };
    onStatus(status);
  };

  const end = () => {
    stopped = true;
    clearInterval(timer);
  };

  const maybeDeliver = async (): Promise<void> => {
    if (!isDue(state, now(), opts.timing)) return;
    const taken = takeReport(state, now());
    if (!taken) return;
    const outcome = await deliver(
      opts,
      pr,
      composeBabysitPrompt(pr, taken.report)
    );
    if (outcome === 'busy') return;
    if (outcome === 'failed') {
      publish({ lastError: 'Could not reach an agent for the pull request' });
      return;
    }
    state = taken.state;
    publish({
      lastDeliveredAt: taken.state.lastDeliveredAt,
      deliveries: status.deliveries + 1,
      lastError: null,
    });
  };

  const poll = async (): Promise<void> => {
    if (stopped || !isCurrent()) return;
    try {
      const latest = await opts.readPullRequest();
      if (latest === null) {
        end();
        publish({ phase: 'ended', lastPolledAt: now() });
        return;
      }
      pr = latest;
      const observation = await observePullRequest(
        pr,
        opts.provider,
        opts.getConfig()
      );
      if (stopped) return;
      state = observe(state, observation, now());
      publish({ lastPolledAt: now(), lastError: null });
      await maybeDeliver();
    } catch (err: unknown) {
      logError('babysit', err);
      publish({ lastError: err instanceof Error ? err.message : String(err) });
    }
  };

  const enqueue = (): Promise<void> => {
    tail = tail.then(poll).catch(() => undefined);
    return tail;
  };

  const timer = setInterval(() => void enqueue(), intervalMs);
  timer.unref?.();
  void enqueue();

  return {
    pollNow: enqueue,
    status: () => status,
    stop: end,
  };
}
