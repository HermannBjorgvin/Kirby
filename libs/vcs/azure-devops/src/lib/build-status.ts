import type { BuildStatusState } from '@kirby/vcs-core';
import type { AdoConfig } from './client.js';
import { authHeaders, baseUrl } from './client.js';
import { adoGet, TTL } from './request.js';

// CI reaches an Azure pull request by two unrelated routes, and a
// repository usually only uses one: pipelines run against the merge
// ref and are read from the builds API, while every other kind of
// check posts into the pull request's status list. This module owns the
// status list; the pipeline runs live in builds.ts, and
// `combineBuildStatus` at the bottom reduces the two to one verdict.

// ── The status list ─────────────────────────────────────────────────

/** One entry from a pull request's status list. */
export interface AdoPrStatus {
  state?: string;
  /** Identifies the check this status is about. Two entries sharing a
   *  context are the same check reporting twice, not two checks. */
  context?: { genre?: string; name?: string };
  /** Per-PR sequential id: higher is newer. */
  id?: number;
  creationDate?: string;
  updatedDate?: string;
  /** The PR iteration (push) the status was posted against. */
  iterationId?: number;
}

function mapRawState(raw: string | undefined): BuildStatusState {
  // `notSet` is zero in Azure's enum, and the field is simply absent
  // from the JSON when it holds that value — the entries that arrive
  // with no `state` at all are the ones describing a queued check.
  if (raw === undefined) return 'pending';
  switch (raw) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'error':
      return 'failed';
    case 'pending':
    case 'notSet':
      return 'pending';
    default:
      return 'none';
  }
}

/** Key identifying the check a status belongs to. */
function statusContextKey(status: AdoPrStatus, index: number): string {
  const genre = status.context?.genre;
  const name = status.context?.name;
  // Without a context there is nothing to group on, so each entry
  // stands alone and contributes its own verdict — the old behaviour,
  // which is right when the entries really are separate checks.
  if (!genre && !name) return `@${index}`;
  return `${genre ?? ''}/${name ?? ''}`;
}

/**
 * What a status is ordered by, with its defaults resolved. `at` is
 * null when the entry carries no parseable date, which is the case
 * that has to skip the date comparison rather than lose it.
 */
function orderKey(status: AdoPrStatus): {
  iteration: number;
  at: number | null;
  id: number;
} {
  const parsed = Date.parse(status.creationDate ?? status.updatedDate ?? '');
  return {
    iteration: status.iterationId ?? 0,
    at: Number.isNaN(parsed) ? null : parsed,
    id: status.id ?? 0,
  };
}

/** Later of two statuses for the same check. */
function isNewer(a: AdoPrStatus, b: AdoPrStatus): boolean {
  const x = orderKey(a);
  const y = orderKey(b);
  if (x.iteration !== y.iteration) return x.iteration > y.iteration;
  if (x.at !== null && y.at !== null && x.at !== y.at) return x.at > y.at;
  // Same instant, or undated: fall back to the sequential id. Two
  // statuses posted in the same second is normal for a fast pipeline.
  return x.id > y.id;
}

/**
 * The current build state of a pull request, from its status list.
 *
 * Azure appends to that list rather than replacing: re-running a
 * pipeline, or pushing a fix, leaves the old entry in place and adds a
 * new one. Reducing over every entry therefore made one failure
 * permanent — a pull request that failed and was then fixed reported
 * `failed` for the rest of its life, and no amount of refreshing could
 * clear it, because the data really did still say so.
 *
 * So each check gets one vote: entries are grouped by their context and
 * only the newest in each group is counted. Newest means the highest
 * iteration, then the latest date, then the highest id — a pipeline
 * that finishes twice within the same second still resolves in order.
 * Aggregation across checks is unchanged: any failure is a failure,
 * then any pending, then success.
 *
 * `notApplicable` takes part in that contest rather than being filtered
 * out first. It is a check saying it does not apply here, and when that
 * is its latest word it retracts whatever it said earlier — a check that
 * failed, was re-run, and then declared itself not applicable should
 * leave no mark. It still casts no vote of its own.
 */
export function deriveBuildStatus(statuses: AdoPrStatus[]): BuildStatusState {
  const latestPerContext = new Map<string, AdoPrStatus>();
  statuses.forEach((status, index) => {
    const key = statusContextKey(status, index);
    const seen = latestPerContext.get(key);
    if (!seen || isNewer(status, seen)) latestPerContext.set(key, status);
  });

  let hasFailed = false;
  let hasPending = false;
  let hasSucceeded = false;
  for (const status of latestPerContext.values()) {
    if (status.state === 'notApplicable') continue;
    const mapped = mapRawState(status.state);
    if (mapped === 'failed') hasFailed = true;
    if (mapped === 'pending') hasPending = true;
    if (mapped === 'succeeded') hasSucceeded = true;
  }

  if (hasFailed) return 'failed';
  if (hasPending) return 'pending';
  if (hasSucceeded) return 'succeeded';
  return 'none';
}

export async function fetchPrBuildStatus(
  config: AdoConfig,
  prId: number
): Promise<BuildStatusState> {
  const data = await adoGet<{ value?: unknown[] }>(
    'fetchPrBuildStatus',
    `${config.org}/${config.project}/${config.repo}/statuses/${prId}`,
    TTL.statuses,
    `${baseUrl(config)}/pullrequests/${prId}/statuses?api-version=7.1`,
    authHeaders(config.pat),
    `statuses for pull request ${prId}`
  );
  return deriveBuildStatus((data.value ?? []) as AdoPrStatus[]);
}

// ── Combining the two routes ────────────────────────────────────────

/** Worst of two verdicts — a red anywhere makes the pull request red. */
export function combineBuildStatus(
  a: BuildStatusState,
  b: BuildStatusState
): BuildStatusState {
  if (a === 'failed' || b === 'failed') return 'failed';
  if (a === 'pending' || b === 'pending') return 'pending';
  if (a === 'succeeded' || b === 'succeeded') return 'succeeded';
  return 'none';
}
