import type {
  VcsProvider,
  AppConfig,
  BranchPrMap,
  PullRequestInfo,
  PullRequestReviewer,
  ReviewDecision,
  BuildStatusState,
} from '@kirby/vcs-core';

// ── Internal helpers ───────────────────────────────────────────────

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function parseGitHubRemoteUrl(
  url: string
): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/{owner}/{repo}[.git]
  const https = url.match(/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (https) return { owner: https[1]!, repo: https[2]! };
  // SSH: git@github.com:{owner}/{repo}[.git]
  const ssh = url.match(/github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  return null;
}

export function mapReviewState(state: string): ReviewDecision {
  switch (state) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changes-requested';
    case 'DISMISSED':
      return 'declined';
    case 'COMMENTED':
    case 'PENDING':
    default:
      return 'no-response';
  }
}

export function latestReviewPerUser(
  reviews: Array<{ user: { login: string }; state: string }>
): PullRequestReviewer[] {
  const byUser = new Map<string, { login: string; state: string }>();
  for (const r of reviews) {
    byUser.set(r.user.login, { login: r.user.login, state: r.state });
  }
  return [...byUser.values()].map((r) => ({
    displayName: r.login,
    identifier: r.login,
    decision: mapReviewState(r.state),
  }));
}

export function deriveCheckRunStatus(
  checkRuns: Array<{ status: string; conclusion: string | null }>
): BuildStatusState {
  if (checkRuns.length === 0) return 'none';

  let hasFailed = false;
  let hasPending = false;
  let hasSucceeded = false;

  for (const cr of checkRuns) {
    if (cr.status === 'completed') {
      if (cr.conclusion === 'success') {
        hasSucceeded = true;
      } else if (
        cr.conclusion === 'failure' ||
        cr.conclusion === 'timed_out' ||
        cr.conclusion === 'cancelled' ||
        cr.conclusion === 'action_required'
      ) {
        hasFailed = true;
      }
    } else {
      // queued, in_progress, pending
      hasPending = true;
    }
  }

  if (hasFailed) return 'failed';
  if (hasPending) return 'pending';
  if (hasSucceeded) return 'succeeded';
  return 'none';
}

// ── API helpers ────────────────────────────────────────────────────

interface GitHubPrRaw {
  number: number;
  title: string;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  user: { login: string };
  draft: boolean;
}

export async function fetchOpenPrs(
  token: string,
  project: Record<string, string>
): Promise<PullRequestInfo[]> {
  const url = `https://api.github.com/repos/${project.owner}/${project.repo}/pulls?state=open&per_page=100`;
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }
  const prs = (await res.json()) as GitHubPrRaw[];
  return prs.map((pr) => ({
    id: pr.number,
    title: pr.title,
    sourceBranch: pr.head.ref,
    targetBranch: pr.base.ref,
    url: pr.html_url,
    createdByIdentifier: pr.user.login,
    createdByDisplayName: pr.user.login,
    isDraft: pr.draft,
  }));
}

export async function fetchReviews(
  token: string,
  project: Record<string, string>,
  prNumber: number
): Promise<PullRequestReviewer[]> {
  const url = `https://api.github.com/repos/${project.owner}/${project.repo}/pulls/${prNumber}/reviews`;
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }
  const reviews = (await res.json()) as Array<{
    user: { login: string };
    state: string;
  }>;
  return latestReviewPerUser(reviews);
}

export async function fetchCheckRuns(
  token: string,
  project: Record<string, string>,
  ref: string
): Promise<BuildStatusState> {
  const url = `https://api.github.com/repos/${project.owner}/${project.repo}/commits/${ref}/check-runs?per_page=100`;
  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as {
    check_runs: Array<{ status: string; conclusion: string | null }>;
  };
  return deriveCheckRunStatus(data.check_runs ?? []);
}

// ── VcsProvider implementation ──────────────────────────────────────

export const githubProvider: VcsProvider = {
  id: 'github',
  displayName: 'GitHub',

  authFields: [{ key: 'token', label: 'Personal Access Token', masked: true }],

  projectFields: [
    { key: 'owner', label: 'Owner' },
    { key: 'repo', label: 'Repository' },
    { key: 'username', label: 'GitHub Username' },
  ],

  parseRemoteUrl(url: string): Record<string, string> | null {
    return parseGitHubRemoteUrl(url);
  },

  isConfigured(
    auth: Record<string, string>,
    project: Record<string, string>
  ): boolean {
    return !!(auth.token && project.owner && project.repo);
  },

  matchesUser(identifier: string, config: AppConfig): boolean {
    const username = config.vendorProject?.username;
    if (username) {
      return identifier.toLowerCase() === username.toLowerCase();
    }
    return identifier.toLowerCase() === (config.email ?? '').toLowerCase();
  },

  async fetchPullRequests(
    auth: Record<string, string>,
    project: Record<string, string>
  ): Promise<BranchPrMap> {
    const prs = await fetchOpenPrs(auth.token!, project);
    const withDetails = await Promise.all(
      prs.map(async (pr) => {
        const [reviewers, buildStatus] = await Promise.all([
          fetchReviews(auth.token!, project, pr.id),
          fetchCheckRuns(auth.token!, project, pr.sourceBranch),
        ]);
        return { ...pr, reviewers, buildStatus } satisfies PullRequestInfo;
      })
    );
    const map: BranchPrMap = {};
    for (const pr of withDetails) {
      map[pr.sourceBranch] = pr;
    }
    return map;
  },

  getPullRequestUrl(project: Record<string, string>, prId: number): string {
    return `https://github.com/${project.owner}/${project.repo}/pull/${prId}`;
  },
};
