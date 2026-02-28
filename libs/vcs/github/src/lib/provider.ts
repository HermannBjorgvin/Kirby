import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  VcsProvider,
  AppConfig,
  BranchPrMap,
  PullRequestInfo,
  PullRequestReviewer,
  ReviewDecision,
  BuildStatusState,
} from '@kirby/vcs-core';

// ── gh CLI transport ──────────────────────────────────────────────

const execFile = promisify(execFileCb);

function extractStderr(err: unknown): string {
  if (err != null && typeof err === 'object' && 'stderr' in err) {
    return String((err as { stderr: unknown }).stderr).trim();
  }
  return String(err);
}

export async function ghApi(endpoint: string): Promise<unknown> {
  try {
    const { stdout } = await execFile('gh', ['api', endpoint]);
    return JSON.parse(stdout);
  } catch (err: unknown) {
    throw new Error(`gh api error: ${extractStderr(err)}`);
  }
}

export async function ghGraphQL(
  query: string,
  variables: Record<string, string | number>
): Promise<unknown> {
  try {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, val] of Object.entries(variables)) {
      args.push('-F', `${key}=${val}`);
    }
    const { stdout } = await execFile('gh', args);
    return JSON.parse(stdout);
  } catch (err: unknown) {
    throw new Error(`gh graphql error: ${extractStderr(err)}`);
  }
}

// ── Internal types ────────────────────────────────────────────────

interface GitHubProject {
  owner: string;
  repo: string;
}

function toGitHubProject(project: Record<string, string>): GitHubProject {
  return { owner: project.owner ?? '', repo: project.repo ?? '' };
}

// ── Internal helpers ───────────────────────────────────────────────

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
  gh: GitHubProject
): Promise<PullRequestInfo[]> {
  const data = (await ghApi(
    `repos/${gh.owner}/${gh.repo}/pulls?state=open&per_page=100`
  )) as GitHubPrRaw[];
  return data.map((pr) => ({
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
  gh: GitHubProject,
  prNumber: number
): Promise<PullRequestReviewer[]> {
  const data = (await ghApi(
    `repos/${gh.owner}/${gh.repo}/pulls/${prNumber}/reviews`
  )) as Array<{ user: { login: string }; state: string }>;
  return latestReviewPerUser(data);
}

export async function fetchCheckRuns(
  gh: GitHubProject,
  ref: string
): Promise<BuildStatusState> {
  const data = (await ghApi(
    `repos/${gh.owner}/${gh.repo}/commits/${ref}/check-runs?per_page=100`
  )) as { check_runs: Array<{ status: string; conclusion: string | null }> };
  return deriveCheckRunStatus(data.check_runs ?? []);
}

const UNRESOLVED_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 0) {
          totalCount
        }
        resolvedThreads: reviewThreads(first: 0, filterBy: {resolved: true}) {
          totalCount
        }
      }
    }
  }
`;

interface UnresolvedThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: { totalCount: number };
        resolvedThreads: { totalCount: number };
      };
    };
  };
}

export async function fetchUnresolvedThreadCount(
  gh: GitHubProject,
  prNumber: number
): Promise<number> {
  const result = (await ghGraphQL(UNRESOLVED_THREADS_QUERY, {
    owner: gh.owner,
    repo: gh.repo,
    number: prNumber,
  })) as UnresolvedThreadsResponse;
  const pr = result.data.repository.pullRequest;
  return pr.reviewThreads.totalCount - pr.resolvedThreads.totalCount;
}

// ── VcsProvider implementation ──────────────────────────────────────

export const githubProvider: VcsProvider = {
  id: 'github',
  displayName: 'GitHub',

  authFields: [],

  projectFields: [
    { key: 'owner', label: 'Owner' },
    { key: 'repo', label: 'Repository' },
    { key: 'username', label: 'GitHub Username' },
  ],

  parseRemoteUrl(url: string): Record<string, string> | null {
    return parseGitHubRemoteUrl(url);
  },

  isConfigured(
    _auth: Record<string, string>,
    project: Record<string, string>
  ): boolean {
    return !!(project.owner && project.repo);
  },

  matchesUser(identifier: string, config: AppConfig): boolean {
    const username = config.vendorProject?.username;
    if (!username) return false;
    return identifier.toLowerCase() === username.toLowerCase();
  },

  async fetchPullRequests(
    _auth: Record<string, string>,
    project: Record<string, string>
  ): Promise<BranchPrMap> {
    const gh = toGitHubProject(project);
    const prs = await fetchOpenPrs(gh);
    const withDetails = await Promise.all(
      prs.map(async (pr) => {
        const [reviewers, buildStatus, activeCommentCount] = await Promise.all([
          fetchReviews(gh, pr.id),
          fetchCheckRuns(gh, pr.sourceBranch),
          fetchUnresolvedThreadCount(gh, pr.id),
        ]);
        return {
          ...pr,
          reviewers,
          buildStatus,
          activeCommentCount,
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
    return `https://github.com/${project.owner}/${project.repo}/pull/${prId}`;
  },
};
