import type {
  VcsProvider,
  AppConfig,
  BranchPrMap,
  PullRequestInfo,
  PullRequestReviewer,
  ReviewDecision,
  BuildStatusState,
} from '@kirby/vcs-core';

// ── Internal ADO types ─────────────────────────────────────────────

type ReviewerVote = 10 | 5 | 0 | -5 | -10;

interface AdoConfig {
  org: string;
  project: string;
  repo: string;
  pat: string;
}

interface RawReviewer {
  displayName?: string;
  uniqueName?: string;
  id?: string;
  vote?: number;
  hasDeclined?: boolean;
  isContainer?: boolean;
}

// ── Internal helpers ───────────────────────────────────────────────

function authHeaders(pat: string): Record<string, string> {
  return {
    Authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

function baseUrl(config: AdoConfig): string {
  return `https://dev.azure.com/${config.org}/${config.project}/_apis/git/repositories/${config.repo}`;
}

function toAdoConfig(
  auth: Record<string, string>,
  project: Record<string, string>
): AdoConfig {
  return {
    org: project.org ?? '',
    project: project.project ?? '',
    repo: project.repo ?? '',
    pat: auth.pat ?? '',
  };
}

function voteToDecision(vote: number, hasDeclined: boolean): ReviewDecision {
  if (hasDeclined) return 'declined';
  if (vote === 10 || vote === 5) return 'approved';
  if (vote === -5 || vote === -10) return 'changes-requested';
  return 'no-response';
}

export function parseReviewer(raw: RawReviewer): PullRequestReviewer {
  const vote = raw.vote ?? 0;
  const validVotes: ReviewerVote[] = [10, 5, 0, -5, -10];
  const normalizedVote = validVotes.includes(vote as ReviewerVote)
    ? (vote as ReviewerVote)
    : 0;
  return {
    displayName: raw.displayName ?? 'Unknown',
    identifier: raw.uniqueName ?? '',
    decision: voteToDecision(normalizedVote, raw.hasDeclined ?? false),
  };
}

export function parsePullRequest(
  raw: {
    pullRequestId?: number;
    title?: string;
    sourceRefName?: string;
    targetRefName?: string;
    isDraft?: boolean;
    reviewers?: RawReviewer[];
    createdBy?: { uniqueName?: string; displayName?: string };
    lastMergeSourceCommit?: { commitId?: string };
  },
  project: Record<string, string>
): Omit<PullRequestInfo, 'activeCommentCount' | 'buildStatus'> {
  const sourceBranch = (raw.sourceRefName ?? '').replace(/^refs\/heads\//, '');
  const targetBranch = (raw.targetRefName ?? '').replace(/^refs\/heads\//, '');
  const prId = raw.pullRequestId ?? 0;
  return {
    id: prId,
    title: raw.title ?? '',
    sourceBranch,
    targetBranch,
    isDraft: raw.isDraft ?? false,
    reviewers: (raw.reviewers ?? []).map(parseReviewer),
    createdByIdentifier: raw.createdBy?.uniqueName ?? '',
    createdByDisplayName: raw.createdBy?.displayName ?? '',
    url: `https://dev.azure.com/${project.org}/${project.project}/_git/${project.repo}/pullrequest/${prId}`,
    headSha: raw.lastMergeSourceCommit?.commitId,
  };
}

export function countActiveThreads(
  threads: {
    status?: string;
    comments?: { commentType?: string }[];
  }[]
): number {
  return threads.filter((t) => {
    if (t.status !== 'active') return false;
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
  statuses: { state?: string }[]
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

export async function fetchAuthenticatedUserEmail(
  config: AdoConfig
): Promise<string> {
  const url = `https://dev.azure.com/${config.org}/_apis/connectiondata?api-version=7.1-preview`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as {
    authenticatedUser?: {
      properties?: { Account?: { $value?: string } };
    };
  };
  return data.authenticatedUser?.properties?.Account?.$value ?? '';
}

export async function fetchMyTeamIds(config: AdoConfig): Promise<Set<string>> {
  const url = `https://dev.azure.com/${config.org}/_apis/projects/${config.project}/teams?$mine=true&api-version=7.1`;
  try {
    const res = await fetch(url, { headers: authHeaders(config.pat) });
    if (!res.ok) return new Set();
    const data = (await res.json()) as { value?: { id?: string }[] };
    return new Set(
      (data.value ?? []).map((t) => t.id).filter((id): id is string => !!id)
    );
  } catch {
    return new Set();
  }
}

export function enrichReviewersWithTeamMembership(
  rawReviewers: RawReviewer[],
  myTeamIds: Set<string>,
  userEmail: string
): RawReviewer[] {
  if (myTeamIds.size === 0 || !userEmail) return rawReviewers;

  const hasExplicitUser = rawReviewers.some(
    (r) =>
      !r.isContainer && r.uniqueName?.toLowerCase() === userEmail.toLowerCase()
  );
  if (hasExplicitUser) return rawReviewers;

  const result = [...rawReviewers];
  for (const r of rawReviewers) {
    if (r.isContainer && r.id && myTeamIds.has(r.id)) {
      result.push({
        displayName: r.displayName ?? 'Unknown',
        uniqueName: userEmail,
        vote: r.vote,
        hasDeclined: r.hasDeclined,
        isContainer: false,
      });
      break; // only add one synthetic entry
    }
  }
  return result;
}

export async function fetchActivePullRequests(
  config: AdoConfig,
  project: Record<string, string>,
  teamContext?: { myTeamIds: Set<string>; userEmail: string }
): Promise<Omit<PullRequestInfo, 'activeCommentCount' | 'buildStatus'>[]> {
  const url = `${baseUrl(
    config
  )}/pullrequests?searchCriteria.status=active&api-version=7.1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as { value?: unknown[] };
  return ((data.value ?? []) as Record<string, unknown>[]).map((raw) => {
    if (teamContext) {
      const rawWithReviewers = raw as { reviewers?: RawReviewer[] };
      if (rawWithReviewers.reviewers) {
        rawWithReviewers.reviewers = enrichReviewersWithTeamMembership(
          rawWithReviewers.reviewers,
          teamContext.myTeamIds,
          teamContext.userEmail
        );
      }
    }
    return parsePullRequest(raw, project);
  });
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
    (data.value ?? []) as {
      status?: string;
      comments?: { commentType?: string }[];
    }[]
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
  return deriveBuildStatus((data.value ?? []) as { state?: string }[]);
}

/**
 * Parse org, project, and repo from an Azure DevOps git remote URL.
 * Supports both SSH and HTTPS formats.
 */
export function parseAdoRemoteUrl(
  url: string
): { org: string; project: string; repo: string } | null {
  const httpsMatch = url.match(
    /dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/
  );
  if (httpsMatch) {
    return {
      org: httpsMatch[1]!,
      project: httpsMatch[2]!,
      repo: httpsMatch[3]!.replace(/\.git$/, ''),
    };
  }

  const sshMatch = url.match(
    /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/
  );
  if (sshMatch) {
    return {
      org: sshMatch[1]!,
      project: sshMatch[2]!,
      repo: sshMatch[3]!.replace(/\.git$/, ''),
    };
  }

  return null;
}

// ── Identity cache (avoids redundant API calls per poll) ────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let identityCache: {
  userEmail: string;
  myTeamIds: Set<string>;
  fetchedAt: number;
} | null = null;

async function getCachedIdentity(
  config: AdoConfig
): Promise<{ userEmail: string; myTeamIds: Set<string> }> {
  if (identityCache && Date.now() - identityCache.fetchedAt < CACHE_TTL_MS) {
    return identityCache;
  }
  const [userEmail, myTeamIds] = await Promise.all([
    fetchAuthenticatedUserEmail(config).catch(() => ''),
    fetchMyTeamIds(config),
  ]);
  identityCache = { userEmail, myTeamIds, fetchedAt: Date.now() };
  return identityCache;
}

// ── VcsProvider implementation ──────────────────────────────────────

export const azureDevOpsProvider: VcsProvider = {
  id: 'azure-devops',
  displayName: 'Azure DevOps',

  authFields: [{ key: 'pat', label: 'Personal Access Token', masked: true }],

  projectFields: [
    { key: 'org', label: 'Organization' },
    { key: 'project', label: 'Project' },
    { key: 'repo', label: 'Repository' },
  ],

  parseRemoteUrl(url: string): Record<string, string> | null {
    return parseAdoRemoteUrl(url);
  },

  isConfigured(
    auth: Record<string, string>,
    project: Record<string, string>
  ): boolean {
    return !!(auth.pat && project.org && project.project && project.repo);
  },

  matchesUser(identifier: string, config: AppConfig): boolean {
    return identifier.toLowerCase() === (config.email ?? '').toLowerCase();
  },

  async fetchPullRequests(
    auth: Record<string, string>,
    project: Record<string, string>
  ): Promise<BranchPrMap> {
    const config = toAdoConfig(auth, project);

    const { userEmail, myTeamIds } = await getCachedIdentity(config);
    const teamContext =
      userEmail && myTeamIds.size > 0 ? { myTeamIds, userEmail } : undefined;

    const prs = await fetchActivePullRequests(config, project, teamContext);

    const withDetails = await Promise.all(
      prs.map(async (pr) => {
        const [activeCommentCount, buildStatus] = await Promise.all([
          fetchActiveCommentCount(config, pr.id),
          fetchPrBuildStatus(config, pr.id),
        ]);
        return {
          ...pr,
          activeCommentCount,
          buildStatus,
        } satisfies PullRequestInfo;
      })
    );

    const map: BranchPrMap = {};
    for (const pr of withDetails) {
      map[pr.sourceBranch] = pr;
    }
    return map;
  },

  getPullRequestUrl(project: Record<string, string>, prId: number): string {
    return `https://dev.azure.com/${project.org}/${project.project}/_git/${project.repo}/pullrequest/${prId}`;
  },

  async fetchMergedBranches(
    auth: Record<string, string>,
    project: Record<string, string>,
    branches: string[]
  ): Promise<Set<string>> {
    if (branches.length === 0) return new Set();
    const config = toAdoConfig(auth, project);
    const url = `${baseUrl(
      config
    )}/pullrequests?searchCriteria.status=completed&api-version=7.1`;
    const res = await fetch(url, { headers: authHeaders(config.pat) });
    if (!res.ok) return new Set();

    const data = (await res.json()) as {
      value?: { sourceRefName?: string }[];
    };
    const branchSet = new Set(branches);
    const matched = new Set<string>();
    for (const pr of data.value ?? []) {
      const source = (pr.sourceRefName ?? '').replace(/^refs\/heads\//, '');
      if (branchSet.has(source)) matched.add(source);
    }
    return matched;
  },
};
