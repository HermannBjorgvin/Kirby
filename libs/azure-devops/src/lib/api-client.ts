import type {
  PullRequestInfo,
  PullRequestReviewer,
  ReviewerVote,
  BuildStatusState,
  BranchPrMap,
} from '@kirby/shared-types';

export interface AdoConfig {
  org: string;
  project: string;
  repo: string;
  pat: string;
}

function authHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function baseUrl(config: AdoConfig): string {
  return `https://dev.azure.com/${config.org}/${config.project}/_apis/git/repositories/${config.repo}`;
}

export function parseReviewer(raw: {
  displayName?: string;
  uniqueName?: string;
  vote?: number;
  hasDeclined?: boolean;
}): PullRequestReviewer {
  const vote = raw.vote ?? 0;
  const validVotes: ReviewerVote[] = [10, 5, 0, -5, -10];
  return {
    displayName: raw.displayName ?? 'Unknown',
    uniqueName: raw.uniqueName ?? '',
    vote: validVotes.includes(vote as ReviewerVote)
      ? (vote as ReviewerVote)
      : 0,
    hasDeclined: raw.hasDeclined ?? false,
  };
}

export function parsePullRequest(raw: {
  pullRequestId?: number;
  title?: string;
  sourceRefName?: string;
  targetRefName?: string;
  isDraft?: boolean;
  reviewers?: Array<{
    displayName?: string;
    uniqueName?: string;
    vote?: number;
    hasDeclined?: boolean;
  }>;
  createdBy?: { uniqueName?: string; displayName?: string };
}): Omit<PullRequestInfo, 'activeCommentCount' | 'buildStatus'> {
  const sourceBranch = (raw.sourceRefName ?? '').replace(/^refs\/heads\//, '');
  const targetBranch = (raw.targetRefName ?? '').replace(/^refs\/heads\//, '');
  return {
    pullRequestId: raw.pullRequestId ?? 0,
    title: raw.title ?? '',
    sourceBranch,
    targetBranch,
    isDraft: raw.isDraft ?? false,
    reviewers: (raw.reviewers ?? []).map(parseReviewer),
    createdByUniqueName: raw.createdBy?.uniqueName,
    createdByDisplayName: raw.createdBy?.displayName,
  };
}

export function countActiveThreads(
  threads: Array<{
    status?: string;
    comments?: Array<{ commentType?: string }>;
  }>
): number {
  return threads.filter((t) => {
    if (t.status !== 'active') return false;
    // Exclude system-only threads (no human comments)
    const hasHumanComment = (t.comments ?? []).some(
      (c) => c.commentType !== 'system'
    );
    return hasHumanComment;
  }).length;
}

function mapRawState(raw: string | undefined): BuildStatusState {
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

export function deriveBuildStatus(
  statuses: Array<{ state?: string }>
): BuildStatusState {
  let hasFailed = false;
  let hasPending = false;
  let hasSucceeded = false;

  for (const s of statuses) {
    if (s.state === 'notApplicable') continue;
    const mapped = mapRawState(s.state);
    if (mapped === 'failed') hasFailed = true;
    if (mapped === 'pending') hasPending = true;
    if (mapped === 'succeeded') hasSucceeded = true;
  }

  if (hasFailed) return 'failed';
  if (hasPending) return 'pending';
  if (hasSucceeded) return 'succeeded';
  return 'none';
}

export async function fetchActivePullRequests(
  config: AdoConfig
): Promise<Array<Omit<PullRequestInfo, 'activeCommentCount' | 'buildStatus'>>> {
  const url = `${baseUrl(
    config
  )}/pullrequests?searchCriteria.status=active&api-version=7.1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as { value?: unknown[] };
  return ((data.value ?? []) as Array<Record<string, unknown>>).map(
    parsePullRequest
  );
}

export async function fetchActiveCommentCount(
  config: AdoConfig,
  prId: number
): Promise<number> {
  const url = `${baseUrl(config)}/pullrequests/${prId}/threads?api-version=7.1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as { value?: unknown[] };
  return countActiveThreads(
    (data.value ?? []) as Array<{
      status?: string;
      comments?: Array<{ commentType?: string }>;
    }>
  );
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
  return deriveBuildStatus((data.value ?? []) as Array<{ state?: string }>);
}

export async function fetchPullRequestsWithComments(
  config: AdoConfig
): Promise<BranchPrMap> {
  const prs = await fetchActivePullRequests(config);

  // Fetch thread counts and build statuses in parallel
  const withComments = await Promise.all(
    prs.map(async (pr) => {
      const [activeCommentCount, buildStatus] = await Promise.all([
        fetchActiveCommentCount(config, pr.pullRequestId),
        fetchPrBuildStatus(config, pr.pullRequestId),
      ]);
      return {
        ...pr,
        activeCommentCount,
        buildStatus,
      } satisfies PullRequestInfo;
    })
  );

  const map: BranchPrMap = {};
  for (const pr of withComments) {
    map[pr.sourceBranch] = pr;
  }
  return map;
}
