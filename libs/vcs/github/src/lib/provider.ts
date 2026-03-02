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

function extractErrorMessage(err: unknown): string {
  if (err == null || typeof err !== 'object') return String(err);
  const e = err as Record<string, unknown>;
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (stderr) return stderr;
  const stdout = typeof e.stdout === 'string' ? e.stdout.trim() : '';
  if (stdout) return stdout;
  if (e.message) return String(e.message);
  return String(err);
}

export async function ghGraphQL(
  query: string,
  variables: Record<string, string | number>
): Promise<unknown> {
  try {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, val] of Object.entries(variables)) {
      if (typeof val === 'number') {
        args.push('-F', `${key}=${val}`);
      } else {
        args.push('-f', `${key}=${val}`);
      }
    }
    const { stdout } = await execFile('gh', args);
    return JSON.parse(stdout);
  } catch (err: unknown) {
    throw new Error(`gh graphql error: ${extractErrorMessage(err)}`);
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
  reviews: Array<{ author: { login: string }; state: string }>,
  requestedReviewers: Array<{ login: string }> = []
): PullRequestReviewer[] {
  const byUser = new Map<string, { login: string; state: string }>();
  for (const r of requestedReviewers) {
    byUser.set(r.login, { login: r.login, state: 'PENDING' });
  }
  for (const r of reviews) {
    byUser.set(r.author.login, { login: r.author.login, state: r.state });
  }
  return [...byUser.values()].map((r) => ({
    displayName: r.login,
    identifier: r.login,
    decision: mapReviewState(r.state),
  }));
}

// ── gh auth check ─────────────────────────────────────────────────

export async function checkGhAuth(): Promise<{
  authenticated: boolean;
  username?: string;
}> {
  try {
    const { stdout } = await execFile('gh', ['auth', 'status']);
    const match = stdout.match(/Logged in to github\.com account (\S+)/);
    if (match) return { authenticated: true, username: match[1] };
    // Fallback: if "Logged in" appears without the exact pattern
    if (stdout.includes('Logged in')) return { authenticated: true };
    return { authenticated: false };
  } catch (err: unknown) {
    // gh auth status exits non-zero when not authenticated,
    // but the info may still be in stderr
    const e = err as Record<string, unknown>;
    const stderr = typeof e.stderr === 'string' ? e.stderr : '';
    const match = stderr.match(/Logged in to github\.com account (\S+)/);
    if (match) return { authenticated: true, username: match[1] };
    if (stderr.includes('Logged in')) return { authenticated: true };
    return { authenticated: false };
  }
}

// ── GraphQL search ────────────────────────────────────────────────

const SEARCH_PRS_QUERY = `
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on PullRequest {
          number
          title
          headRefName
          baseRefName
          url
          author { login }
          isDraft
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                ... on User { login }
              }
            }
          }
          reviews(last: 100) {
            nodes {
              author { login }
              state
            }
          }
          reviewThreads(first: 100) {
            nodes { isResolved }
          }
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface SearchPrNode {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  author: { login: string };
  isDraft: boolean;
  reviewRequests: {
    nodes: Array<{ requestedReviewer: { login?: string } }>;
  };
  reviews: {
    nodes: Array<{ author: { login: string }; state: string }>;
  };
  reviewThreads: {
    nodes: Array<{ isResolved: boolean }>;
  };
  commits: {
    nodes: Array<{
      commit: {
        statusCheckRollup: { state: string } | null;
      };
    }>;
  };
}

interface SearchPrsResponse {
  data: {
    search: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: SearchPrNode[];
    };
  };
}

export function mapRollupState(
  state: string | null | undefined
): BuildStatusState {
  switch (state) {
    case 'SUCCESS':
      return 'succeeded';
    case 'FAILURE':
    case 'ERROR':
      return 'failed';
    case 'PENDING':
    case 'EXPECTED':
      return 'pending';
    default:
      return 'none';
  }
}

function transformSearchNode(node: SearchPrNode): PullRequestInfo {
  const requestedReviewers = node.reviewRequests.nodes
    .filter((n) => n.requestedReviewer.login)
    .map((n) => ({ login: n.requestedReviewer.login! }));
  const reviewers = latestReviewPerUser(
    node.reviews.nodes,
    requestedReviewers
  );

  const unresolvedCount = node.reviewThreads.nodes.filter(
    (t) => !t.isResolved
  ).length;

  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup;
  const buildStatus = mapRollupState(rollup?.state);

  return {
    id: node.number,
    title: node.title,
    sourceBranch: node.headRefName,
    targetBranch: node.baseRefName,
    url: node.url,
    createdByIdentifier: node.author.login,
    createdByDisplayName: node.author.login,
    isDraft: node.isDraft,
    reviewers,
    buildStatus,
    activeCommentCount: unresolvedCount,
  };
}

// ── Merged PRs search ──────────────────────────────────────────────

const SEARCH_MERGED_PRS_QUERY = `
  query($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on PullRequest {
          headRefName
        }
      }
    }
  }
`;

interface MergedPrNode {
  headRefName: string;
}

interface SearchMergedPrsResponse {
  data: {
    search: {
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
      nodes: MergedPrNode[];
    };
  };
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
    const { owner, repo, username } = project;
    if (!username || !owner || !repo) return {};

    const searchQuery = `repo:${owner}/${repo} is:pr is:open involves:${username}`;

    const map: BranchPrMap = {};
    let cursor: string | undefined;

    do {
      const variables: Record<string, string> = { searchQuery };
      if (cursor) variables.cursor = cursor;

      const result = (await ghGraphQL(
        SEARCH_PRS_QUERY,
        variables
      )) as SearchPrsResponse;

      const { nodes, pageInfo } = result.data.search;
      for (const node of nodes) {
        const pr = transformSearchNode(node);
        map[pr.sourceBranch] = pr;
      }

      cursor =
        pageInfo.hasNextPage && pageInfo.endCursor
          ? pageInfo.endCursor
          : undefined;
    } while (cursor);

    return map;
  },

  getPullRequestUrl(project: Record<string, string>, prId: number): string {
    return `https://github.com/${project.owner}/${project.repo}/pull/${prId}`;
  },

  async fetchMergedBranches(
    _auth: Record<string, string>,
    project: Record<string, string>,
    branches: string[]
  ): Promise<Set<string>> {
    const { owner, repo, username } = project;
    if (!username || !owner || !repo || branches.length === 0) return new Set();

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const searchQuery = `repo:${owner}/${repo} is:pr is:merged author:${username} merged:>${since}`;

    const mergedHeads = new Set<string>();
    let cursor: string | undefined;

    do {
      const variables: Record<string, string> = { searchQuery };
      if (cursor) variables.cursor = cursor;

      const result = (await ghGraphQL(
        SEARCH_MERGED_PRS_QUERY,
        variables
      )) as SearchMergedPrsResponse;

      const { nodes, pageInfo } = result.data.search;
      for (const node of nodes) {
        if (node.headRefName) mergedHeads.add(node.headRefName);
      }

      cursor =
        pageInfo.hasNextPage && pageInfo.endCursor
          ? pageInfo.endCursor
          : undefined;
    } while (cursor);

    const branchSet = new Set(branches);
    const matched = new Set<string>();
    for (const head of mergedHeads) {
      if (branchSet.has(head)) matched.add(head);
    }
    return matched;
  },
};
