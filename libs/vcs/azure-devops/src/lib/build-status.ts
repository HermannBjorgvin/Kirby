import type { BuildStatusState } from '@kirby/vcs-core';
import type { AdoConfig } from './client.js';
import { authHeaders, baseUrl } from './client.js';

// CI reaches an Azure pull request by two unrelated routes, and a
// repository usually only uses one: pipelines run against the merge
// ref and are read from the builds API, while every other kind of
// check posts into the pull request's status list. This module reads
// both and reduces each to a single verdict.

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

/** Later of two statuses for the same check. */
function isNewer(a: AdoPrStatus, b: AdoPrStatus): boolean {
  if ((a.iterationId ?? 0) !== (b.iterationId ?? 0)) {
    return (a.iterationId ?? 0) > (b.iterationId ?? 0);
  }
  const at = Date.parse(a.creationDate ?? a.updatedDate ?? '');
  const bt = Date.parse(b.creationDate ?? b.updatedDate ?? '');
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at > bt;
  // Same instant, or undated: fall back to the sequential id. Two
  // statuses posted in the same second is normal for a fast pipeline.
  return (a.id ?? 0) > (b.id ?? 0);
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
  const url = `${baseUrl(
    config
  )}/pullrequests/${prId}/statuses?api-version=7.1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as { value?: unknown[] };
  return deriveBuildStatus((data.value ?? []) as AdoPrStatus[]);
}

// ── Pipeline runs ───────────────────────────────────────────────────

/** One pipeline run, as the builds API reports it. */
export interface AdoBuildRun {
  id?: number;
  /** `notStarted` | `inProgress` | `completed` | `cancelling` | … */
  status?: string;
  /** Only meaningful once `status` is `completed`. */
  result?: string;
  definition?: { id?: number; name?: string };
  finishTime?: string;
  queueTime?: string;
}

function mapRunResult(run: AdoBuildRun): BuildStatusState {
  // Queued or still going: no verdict yet, but something is happening.
  if (run.status !== 'completed') return 'pending';
  // A partial success is a pipeline that did not pass: calling it green
  // hides the part that broke, and there is no warning state to put it
  // in.
  switch (run.result) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'partiallySucceeded':
      return 'failed';
    case 'canceled':
      // Nobody learned anything from a cancelled run.
      return 'none';
    default:
      return 'none';
  }
}

/**
 * The verdict from the pipelines that ran against a pull request.
 *
 * Same shape of problem as the status list: a definition that has been
 * re-run appears more than once, so only its newest run speaks for it.
 * Runs are ordered newest-first by the API, and the build id rises
 * monotonically, so the highest id per definition wins.
 */
export function deriveBuildRunStatus(runs: AdoBuildRun[]): BuildStatusState {
  const latestPerDefinition = new Map<number | string, AdoBuildRun>();
  runs.forEach((run, index) => {
    const key = run.definition?.id ?? `@${index}`;
    const seen = latestPerDefinition.get(key);
    if (!seen || (run.id ?? 0) > (seen.id ?? 0)) {
      latestPerDefinition.set(key, run);
    }
  });

  let hasFailed = false;
  let hasPending = false;
  let hasSucceeded = false;
  for (const run of latestPerDefinition.values()) {
    const mapped = mapRunResult(run);
    if (mapped === 'failed') hasFailed = true;
    if (mapped === 'pending') hasPending = true;
    if (mapped === 'succeeded') hasSucceeded = true;
  }
  if (hasFailed) return 'failed';
  if (hasPending) return 'pending';
  if (hasSucceeded) return 'succeeded';
  return 'none';
}

/**
 * Pipeline runs for a pull request.
 *
 * Azure builds a pull request against its *merge* ref, not the source
 * branch, so `refs/pull/{id}/merge` is where the runs are — querying the
 * source branch returns nothing at all.
 *
 * This is a separate call from the status list because the two carry
 * different things, and a repository that reports CI one way usually
 * does not report it the other. Reading only the statuses is why a
 * failing pull request could show no CI result: the pipeline had failed,
 * and the coverage check that posts a status withdrew a few seconds
 * later precisely because the build gave it nothing to measure.
 */
export async function fetchPrBuildRuns(
  config: AdoConfig,
  prId: number
): Promise<BuildStatusState> {
  const branch = encodeURIComponent(`refs/pull/${prId}/merge`);
  const url =
    `https://dev.azure.com/${config.org}/${config.project}/_apis/build/builds` +
    `?branchName=${branch}&$top=20&api-version=7.1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as { value?: unknown[] };
  return deriveBuildRunStatus((data.value ?? []) as AdoBuildRun[]);
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
