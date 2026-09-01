import type { BuildStatusState, PullRequestInfo } from '@kirby/vcs-core';
import { combineBuildStatus } from './build-status.js';
import {
  dueForRefresh,
  lastKnownComments,
  lastKnownStatus,
  prDetailMemo,
  REFRESH_BUDGET,
  rememberPrDetails,
  reusableComments,
  reusableStatus,
} from './pr-details.js';

/**
 * What one sync cycle decides to ask about, and what it does with the
 * answers.
 *
 * Kept apart from the provider so the policy can be read — and tested —
 * without a network in the way: the two things it reads are handed in.
 */

/** The per-row reads a cycle can make. Injected, not imported, so this
 *  module does not depend on the provider that uses it. */
export interface RowReaders {
  commentCount(prId: number): Promise<number>;
  buildStatus(prId: number): Promise<BuildStatusState>;
}

/** The pull request fields a cycle needs in order to plan. */
export interface CycleRow {
  id: number;
  headSha?: string;
}

/** What a cycle has decided to do about one pull request. */
export interface RowPlan {
  /** Already known, and still good. */
  knownStatus: BuildStatusState | null;
  knownCount: number | null;
  /** Due, and this cycle has the budget for it. */
  readStatus: boolean;
  readCount: boolean;
}

export const NOTHING_TO_DO: RowPlan = {
  knownStatus: null,
  knownCount: null,
  readStatus: false,
  readCount: false,
};

/**
 * Decide, for every row, what is already known and which of the rest
 * this cycle may spend a request on.
 *
 * Rows read together expire together, so without a budget one quiet
 * cycle becomes a request per row on the next — and it is that shape,
 * rather than the total, that a sliding-window rate limit refuses.
 */
export function planCycle(
  repoKey: string,
  prs: readonly CycleRow[],
  now: number
): Map<number, RowPlan> {
  const known = new Map(
    prs.map((pr) => {
      const memo = prDetailMemo(repoKey, pr.id);
      return [
        pr.id,
        {
          knownStatus: reusableStatus(memo, pr.headSha, now),
          knownCount: reusableComments(memo, now),
        },
      ];
    })
  );
  const due = (
    isUnknown: (prId: number) => boolean,
    readAt: (prId: number) => number | null
  ) =>
    dueForRefresh(
      prs
        .filter((pr) => isUnknown(pr.id))
        .map((pr) => ({ prId: pr.id, readAt: readAt(pr.id) })),
      REFRESH_BUDGET
    );
  const readStatus = due(
    (id) => known.get(id)?.knownStatus == null,
    (id) => prDetailMemo(repoKey, id)?.status?.at ?? null
  );
  const readCount = due(
    (id) => known.get(id)?.knownCount == null,
    (id) => prDetailMemo(repoKey, id)?.comments?.at ?? null
  );
  return new Map(
    prs.map((pr) => [
      pr.id,
      {
        knownStatus: known.get(pr.id)?.knownStatus ?? null,
        knownCount: known.get(pr.id)?.knownCount ?? null,
        readStatus: readStatus.has(pr.id),
        readCount: readCount.has(pr.id),
      },
    ])
  );
}

/** Which rows the cycle is going to read a verdict for. */
export function rowsReadingStatus(
  prs: readonly CycleRow[],
  plans: Map<number, RowPlan>
): number[] {
  return prs.filter((pr) => plans.get(pr.id)?.readStatus).map((pr) => pr.id);
}

/**
 * The verdict this cycle actually established, or null when it did not.
 *
 * A row the runs listing could not account for is absent from that map
 * rather than recorded as `none`; taking the status list as the whole
 * answer would show a red pipeline as green until the memo expired.
 */
function freshVerdict(
  plan: RowPlan,
  prId: number,
  fromStatusList: BuildStatusState | undefined,
  runVerdicts: ReadonlyMap<number, BuildStatusState>
): BuildStatusState | null {
  if (!plan.readStatus) return null;
  const runs = runVerdicts.get(prId);
  if (runs === undefined) return null;
  return combineBuildStatus(fromStatusList ?? 'none', runs);
}

/** The two per-row reads, made only where the plan allows them. */
function readRow(
  plan: RowPlan,
  prId: number,
  read: RowReaders
): Promise<[number | undefined, BuildStatusState | undefined]> {
  return Promise.all([
    plan.readCount ? read.commentCount(prId) : undefined,
    plan.readStatus ? read.buildStatus(prId) : undefined,
  ]);
}

/**
 * Carry out one row's plan, and remember what it learned.
 *
 * Anything the plan had no budget for falls back to whatever was last
 * known — a badge a few minutes old beats one that flickers back to
 * nothing while the budget goes to rows that have waited longer. A row
 * nothing is known about at all shows `none`, which reads as "no CI"
 * and is the honest thing to say when we have not looked.
 */
export async function resolveRow(
  repoKey: string,
  pr: CycleRow,
  read: RowReaders,
  ctx: {
    plan: RowPlan;
    runVerdicts: ReadonlyMap<number, BuildStatusState>;
    now: number;
  }
): Promise<Pick<PullRequestInfo, 'activeCommentCount' | 'buildStatus'>> {
  const { plan, runVerdicts, now } = ctx;
  const memo = prDetailMemo(repoKey, pr.id);
  const [count, fromStatusList] = await readRow(plan, pr.id, read);
  const fresh = freshVerdict(plan, pr.id, fromStatusList, runVerdicts);

  rememberPrDetails(repoKey, pr.id, {
    headSha: pr.headSha,
    now,
    ...(count === undefined ? {} : { comments: count }),
    ...(fresh === null ? {} : { status: fresh }),
  });

  return {
    activeCommentCount: plan.knownCount ?? count ?? lastKnownComments(memo),
    buildStatus: fresh ?? plan.knownStatus ?? lastKnownStatus(memo) ?? 'none',
  };
}
