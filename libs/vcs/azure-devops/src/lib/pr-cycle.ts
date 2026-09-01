import type { BuildStatusState, PullRequestInfo } from '@kirby/vcs-core';
import { combineBuildStatus } from './build-status.js';
import {
  dueForRefresh,
  isPendingVerdict,
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
  /**
   * What the verdict is a verdict *about*. Azure builds the merge ref,
   * which is a function of both sides, so the source commit alone would
   * hold a green badge over a pull request whose build was re-queued —
   * and failed — because the target branch moved under it.
   */
  mergeKey?: string;
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
          knownStatus: reusableStatus(memo, pr.mergeKey, now),
          knownCount: reusableComments(memo, now),
        },
      ];
    })
  );
  // Ordered by when the row was last *read*, not by how old its answer
  // is: a read that established nothing must still send its row to the
  // back, or the same rows are picked forever and the rest never at
  // all. Checks in flight jump the queue — that is the one moment the
  // badge is worth watching.
  const readStatus = dueForRefresh(
    prs
      .filter((pr) => known.get(pr.id)?.knownStatus == null)
      .map((pr) => ({
        prId: pr.id,
        readAt: prDetailMemo(repoKey, pr.id)?.statusReadAt ?? null,
        urgent: isPendingVerdict(prDetailMemo(repoKey, pr.id)),
      })),
    REFRESH_BUDGET
  );
  const readCount = dueForRefresh(
    prs
      .filter((pr) => known.get(pr.id)?.knownCount == null)
      .map((pr) => ({
        prId: pr.id,
        readAt: prDetailMemo(repoKey, pr.id)?.comments?.at ?? null,
      })),
    REFRESH_BUDGET
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
 * What this cycle read, and whether it is worth keeping.
 *
 * The two are not the same, and conflating them was a bug in both
 * directions. A row the runs listing could not account for is absent
 * from that map rather than recorded as `none`, so the status list is
 * not the whole answer and must not be *remembered* — remembering it
 * would show a red pipeline as green until the memo expired. But it is
 * still the best thing to *show* this cycle: throwing away a request
 * that was actually spent leaves a repository whose build route is
 * unreadable — a token without `Build (read)`, say — displaying "no CI"
 * on every row forever, when its status list says plainly that the
 * checks failed.
 */
function verdictFrom(
  plan: RowPlan,
  prId: number,
  fromStatusList: BuildStatusState | undefined,
  runVerdicts: ReadonlyMap<number, BuildStatusState>
): { show: BuildStatusState | null; keep: BuildStatusState | null } {
  if (!plan.readStatus) return { show: null, keep: null };
  const runs = runVerdicts.get(prId);
  const show = combineBuildStatus(fromStatusList ?? 'none', runs ?? 'none');
  return { show, keep: runs === undefined ? null : show };
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
  const verdict = verdictFrom(plan, pr.id, fromStatusList, runVerdicts);

  rememberPrDetails(repoKey, pr.id, {
    mergeKey: pr.mergeKey,
    now,
    statusRead: plan.readStatus,
    ...(count === undefined ? {} : { comments: count }),
    ...(verdict.keep === null ? {} : { status: verdict.keep }),
  });

  return {
    activeCommentCount: plan.knownCount ?? count ?? lastKnownComments(memo),
    buildStatus:
      verdict.show ?? plan.knownStatus ?? lastKnownStatus(memo) ?? 'none',
  };
}
