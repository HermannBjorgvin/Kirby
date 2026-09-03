import type { BuildStatusState, RemoteCommentThread } from '@kirby/vcs-core';

// ── Babysitting a pull request ───────────────────────────────────
//
// A babysat pull request is watched for three things — CI, unresolved
// review comments and conflicts with the target branch — and the agent
// working on it is told about them in one message, once things have
// settled, and only while it is idle. This module is the pure half: it
// remembers what the agent has already been told, works out what is new
// against that, and decides when a pending update is quiet enough to
// send. No timers, no git, no provider: the watcher in
// `pr-babysitter.ts` feeds it observations and asks it what to do.
//
// "What the agent was told" is the baseline, not "what was last seen".
// A comment that arrives between two polls and is answered before the
// next is still news to the agent, and a thread that gained a reply
// since the last update is news again even though the thread itself
// is not. Every rule below is about that baseline.

/** How long an update has to stay unchanged before it is sent. A
 *  reviewer leaves comments in a burst; sending after the first one
 *  would interrupt the agent once per comment. */
export const BABYSIT_DEBOUNCE_MS = 10 * 60_000;
/** A steady trickle of changes would otherwise postpone an update
 *  forever, so a pending update is sent regardless once this old. */
export const BABYSIT_MAX_WAIT_MS = 30 * 60_000;
/** How often the pull request is re-read. */
export const BABYSIT_POLL_MS = 60_000;

/** One unresolved thread, as it stood when observed. */
export interface BabysitThread {
  id: string;
  file: string | null;
  line: number | null;
  /** Every comment in the thread, root first. */
  comments: { author: string; body: string }[];
  /** The newest comment is the user's own (or the agent's, posting as
   *  the user). A reply of ours does not make the thread news. */
  lastCommentIsOwn: boolean;
}

/** What one poll of the pull request found. */
export interface BabysitObservation {
  buildStatus: BuildStatusState | undefined;
  /** Unresolved threads only. */
  threads: BabysitThread[];
  /** Files that conflict with the latest target branch, or null when
   *  the check could not run. */
  conflictCount: number | null;
}

/** What the agent has been told so far. */
export interface ReportedSummary {
  buildStatus: BuildStatusState | undefined;
  conflictCount: number;
  /** Thread id → number of comments the agent knows about. */
  threadComments: Record<string, number>;
}

export interface BabysitReport {
  /** The status as it stands now — always included so the message
   *  answers "how is CI" even when CI is not what changed. */
  buildStatus: BuildStatusState | undefined;
  /** Set when CI settled on a verdict the agent has not heard. */
  ciChanged: boolean;
  /** Set when the conflict count moved to a non-zero value. */
  conflictsChanged: boolean;
  conflictCount: number;
  /** Threads the agent has not seen, or that gained comments since. */
  newThreads: BabysitThread[];
}

export interface BabysitState {
  reported: ReportedSummary;
  latest: BabysitObservation | null;
  /** Identity of the pending report, for telling "same update, still
   *  waiting" from "the update grew". */
  pendingKey: string | null;
  pendingSince: number | null;
  /** When the pending report last changed shape. */
  quietSince: number | null;
  lastDeliveredAt: number | null;
}

export function initialBabysitState(): BabysitState {
  return {
    // Nothing has been reported, so whatever is outstanding when
    // babysitting starts — a red build, three open threads — is the
    // first update. Starting from the current state instead would
    // make "babysit" on a pull request that already needs work do
    // nothing until something else happened.
    reported: { buildStatus: undefined, conflictCount: 0, threadComments: {} },
    latest: null,
    pendingKey: null,
    pendingSince: null,
    quietSince: null,
    lastDeliveredAt: null,
  };
}

function isSettled(status: BuildStatusState | undefined): boolean {
  return status === 'succeeded' || status === 'failed';
}

/**
 * Threads worth telling the agent about: unseen ones, and seen ones
 * that grew — unless the growth is the user's own reply, which the
 * agent either wrote or does not need relayed.
 */
function newThreads(
  reported: ReportedSummary,
  threads: BabysitThread[]
): BabysitThread[] {
  return threads.filter((thread) => {
    const known = reported.threadComments[thread.id];
    if (known === undefined) return true;
    return thread.comments.length > known && !thread.lastCommentIsOwn;
  });
}

/**
 * What the agent would be told now, or null when nothing is worth
 * saying. CI is news when it settles on a verdict other than the one
 * reported — a first green build on its own is not worth a message,
 * but green after a reported red is. A pending build is never news:
 * it is the state between two verdicts.
 */
export function diffAgainstReported(
  reported: ReportedSummary,
  observation: BabysitObservation
): BabysitReport | null {
  const { buildStatus } = observation;
  const settled = isSettled(buildStatus);
  const ciChanged =
    settled &&
    buildStatus !== reported.buildStatus &&
    (buildStatus === 'failed' || reported.buildStatus === 'failed');
  const conflictCount = observation.conflictCount ?? reported.conflictCount;
  const conflictsChanged =
    conflictCount > 0 && conflictCount !== reported.conflictCount;
  const threads = newThreads(reported, observation.threads);
  if (!ciChanged && !conflictsChanged && threads.length === 0) return null;
  return {
    buildStatus,
    ciChanged,
    conflictsChanged,
    conflictCount,
    newThreads: threads,
  };
}

function reportKey(report: BabysitReport): string {
  const threads = report.newThreads
    .map((t) => `${t.id}:${t.comments.length}`)
    .sort()
    .join(',');
  return [
    report.ciChanged ? report.buildStatus : '-',
    report.conflictsChanged ? report.conflictCount : '-',
    threads,
  ].join('|');
}

/** Fold a fresh observation in: start, extend or drop the pending update. */
export function observe(
  state: BabysitState,
  observation: BabysitObservation,
  now: number
): BabysitState {
  const report = diffAgainstReported(state.reported, observation);
  const key = report ? reportKey(report) : null;
  if (key === null) {
    return {
      ...state,
      latest: observation,
      pendingKey: null,
      pendingSince: null,
      quietSince: null,
    };
  }
  if (key === state.pendingKey) return { ...state, latest: observation };
  return {
    ...state,
    latest: observation,
    pendingKey: key,
    pendingSince: state.pendingSince ?? now,
    quietSince: now,
  };
}

export interface DeliveryTiming {
  debounceMs?: number;
  maxWaitMs?: number;
}

/** Whether the pending update has been quiet for long enough to send. */
export function isDue(
  state: BabysitState,
  now: number,
  timing: DeliveryTiming = {}
): boolean {
  const debounceMs = timing.debounceMs ?? BABYSIT_DEBOUNCE_MS;
  const maxWaitMs = timing.maxWaitMs ?? BABYSIT_MAX_WAIT_MS;
  if (state.pendingSince === null || state.quietSince === null) return false;
  return (
    now - state.quietSince >= debounceMs ||
    now - state.pendingSince >= maxWaitMs
  );
}

/**
 * Take the pending update: what to send, and the state in which the
 * agent is deemed to know it. Null when nothing is pending. The whole
 * latest observation becomes the baseline, not only the parts that
 * were news — a thread the agent was told about is known in full.
 */
export function takeReport(
  state: BabysitState,
  now: number
): { report: BabysitReport; state: BabysitState } | null {
  if (!state.latest || state.pendingKey === null) return null;
  const report = diffAgainstReported(state.reported, state.latest);
  if (!report) return null;
  const threadComments: Record<string, number> = {};
  for (const thread of state.latest.threads) {
    threadComments[thread.id] = thread.comments.length;
  }
  return {
    report,
    state: {
      ...state,
      reported: {
        buildStatus: isSettled(report.buildStatus)
          ? report.buildStatus
          : state.reported.buildStatus,
        conflictCount: report.conflictCount,
        threadComments,
      },
      pendingKey: null,
      pendingSince: null,
      quietSince: null,
      lastDeliveredAt: now,
    },
  };
}

/** Project a provider thread onto what the babysitter keeps of it. */
export function observeThread(
  thread: RemoteCommentThread,
  isOwn: (author: string) => boolean
): BabysitThread {
  const comments = thread.comments.map((c) => ({
    author: c.author,
    body: c.body,
  }));
  const last = comments[comments.length - 1];
  return {
    id: thread.id,
    file: thread.file,
    line: thread.lineStart,
    comments,
    lastCommentIsOwn: last ? isOwn(last.author) : false,
  };
}
