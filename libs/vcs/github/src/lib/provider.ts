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

export async function ghApi(endpoint: string): Promise<unknown> {
  try {
    const { stdout } = await execFile('gh', ['api', endpoint]);
    return JSON.parse(stdout);
  } catch (err: unknown) {
    const stderr =
      err != null && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: unknown }).stderr).trim()
        : String(err);
    throw new Error(`gh api error: ${stderr}`);
  }
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
  project: Record<string, string>
): Promise<PullRequestInfo[]> {
  const data = (await ghApi(
    `repos/${project.owner}/${project.repo}/pulls?state=open&per_page=100`
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
  project: Record<string, string>,
  prNumber: number
): Promise<PullRequestReviewer[]> {
  const data = (await ghApi(
    `repos/${project.owner}/${project.repo}/pulls/${prNumber}/reviews`
  )) as Array<{ user: { login: string }; state: string }>;
  return latestReviewPerUser(data);
}

export async function fetchCheckRuns(
  project: Record<string, string>,
  ref: string
): Promise<BuildStatusState> {
  const data = (await ghApi(
    `repos/${project.owner}/${project.repo}/commits/${ref}/check-runs?per_page=100`
  )) as { check_runs: Array<{ status: string; conclusion: string | null }> };
  return deriveCheckRunStatus(data.check_runs ?? []);
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
    if (username) {
      return identifier.toLowerCase() === username.toLowerCase();
    }
    return identifier.toLowerCase() === (config.email ?? '').toLowerCase();
  },

  async fetchPullRequests(
    _auth: Record<string, string>,
    project: Record<string, string>
  ): Promise<BranchPrMap> {
    const prs = await fetchOpenPrs(project);
    const withDetails = await Promise.all(
      prs.map(async (pr) => {
        const [reviewers, buildStatus] = await Promise.all([
          fetchReviews(project, pr.id),
          fetchCheckRuns(project, pr.sourceBranch),
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
