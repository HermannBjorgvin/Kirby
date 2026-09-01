import type { BuildStatusState } from '@kirby/vcs-core';
import type { AdoConfig } from './client.js';
import { authHeaders, baseUrl } from './client.js';
import { adoGet, TTL } from './request.js';

/**
 * Pipeline runs — one of the two unrelated routes CI reaches an Azure
 * pull request by (the other is the status list, in build-status.ts).
 */

/** One pipeline run, as the builds API reports it. */
export interface AdoBuildRun {
  id?: number;
  /** `notStarted` | `inProgress` | `completed` | `cancelling` | … */
  status?: string;
  /** Only meaningful once `status` is `completed`. */
  result?: string;
  definition?: { id?: number; name?: string };
  /** `refs/pull/{id}/merge` for a pull request build. */
  sourceBranch?: string;
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

/** Azure builds a pull request against its *merge* ref, never the
 *  source branch — querying the source branch returns nothing at all. */
export function prMergeRef(prId: number): string {
  return `refs/pull/${prId}/merge`;
}

function buildsUrl(config: AdoConfig, query: string): string {
  return (
    `https://dev.azure.com/${config.org}/${config.project}/_apis/build/builds` +
    `?${query}&api-version=7.1`
  );
}

/** Pipeline runs for a single pull request. The fallback path. */
export async function fetchPrBuildRuns(
  config: AdoConfig,
  prId: number
): Promise<BuildStatusState> {
  const branch = encodeURIComponent(prMergeRef(prId));
  const data = await adoGet<{ value?: unknown[] }>(
    'fetchPrBuildRuns',
    `${config.org}/${config.project}/builds/${prId}`,
    TTL.builds,
    buildsUrl(config, `branchName=${branch}&$top=20`),
    authHeaders(config.pat),
    `builds for pull request ${prId}`
  );
  return deriveBuildRunStatus((data.value ?? []) as AdoBuildRun[]);
}

/**
 * The repository's GUID, which is what the builds API filters on.
 *
 * Worth one call every half hour: with it, the pipeline runs for every
 * open pull request arrive in a single request instead of one per row.
 * Kirby's configuration names the repository, and the builds API will
 * not take a name.
 */
async function fetchRepositoryId(config: AdoConfig): Promise<string | null> {
  const repo = await adoGet<{ id?: string }>(
    'fetchRepositoryId',
    `${config.org}/${config.project}/repo-id/${config.repo}`,
    TTL.identity,
    `${baseUrl(config)}?api-version=7.1`,
    authHeaders(config.pat),
    `repository ${config.repo}`
  );
  return repo.id ?? null;
}

/** How many builds to ask for when covering `prCount` pull requests. */
function batchSize(prCount: number): number {
  return Math.min(500, Math.max(100, prCount * 10));
}

/**
 * Pipeline verdicts for many pull requests in one request.
 *
 * The builds API has no way to name several branches, but it will
 * happily return the repository's recent builds across all of them, and
 * every pull request build carries the merge ref it ran against. So one
 * listing, indexed by that ref, answers every row.
 *
 * The listing is bounded, and a busy repository can fill it entirely
 * with builds for a handful of pull requests. When that happens —
 * detected by the response coming back at exactly the requested size —
 * anything still unaccounted for falls back to its own query, which is
 * the old behaviour and no worse. When it does not, absence is a real
 * answer: the repository has no recent build for that pull request.
 */
export async function fetchPrBuildRunsBatch(
  config: AdoConfig,
  prIds: number[]
): Promise<Map<number, BuildStatusState>> {
  const result = new Map<number, BuildStatusState>();
  if (prIds.length === 0) return result;

  const repositoryId = await fetchRepositoryId(config).catch(() => null);
  if (!repositoryId) return fetchEachSeparately(config, prIds, result);

  const top = batchSize(prIds.length);
  const data = await adoGet<{ value?: unknown[] }>(
    'fetchPrBuildRunsBatch',
    `${config.org}/${config.project}/builds-batch/${repositoryId}/${top}`,
    TTL.builds,
    buildsUrl(
      config,
      `repositoryId=${encodeURIComponent(repositoryId)}` +
        `&repositoryType=TfsGit&$top=${top}&queryOrder=queueTimeDescending`
    ),
    authHeaders(config.pat),
    'pipeline runs'
  );

  const runs = (data.value ?? []) as AdoBuildRun[];
  const byRef = new Map<string, AdoBuildRun[]>();
  for (const run of runs) {
    const ref = run.sourceBranch;
    if (!ref) continue;
    const bucket = byRef.get(ref);
    if (bucket) bucket.push(run);
    else byRef.set(ref, [run]);
  }

  const saturated = runs.length >= top;
  const missing: number[] = [];
  for (const prId of prIds) {
    const forPr = byRef.get(prMergeRef(prId));
    if (forPr) result.set(prId, deriveBuildRunStatus(forPr));
    else if (saturated) missing.push(prId);
    else result.set(prId, 'none');
  }
  return missing.length > 0
    ? fetchEachSeparately(config, missing, result)
    : result;
}

async function fetchEachSeparately(
  config: AdoConfig,
  prIds: number[],
  into: Map<number, BuildStatusState>
): Promise<Map<number, BuildStatusState>> {
  await Promise.all(
    prIds.map(async (prId) => {
      into.set(prId, await fetchPrBuildRuns(config, prId).catch(() => 'none'));
    })
  );
  return into;
}
