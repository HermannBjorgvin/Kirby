import { execFile as execFileCb, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  VcsProvider,
  AppConfig,
  BranchPrMap,
  PullRequestInfo,
  PullRequestReviewer,
  PullRequestComments,
  RemoteCommentThread,
  RemoteCommentReply,
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
  const https = url.match(
    /github\.com\/(?<owner>[^/]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/
  );
  if (https?.groups)
    return { owner: https.groups.owner, repo: https.groups.repo };
  // SSH: git@github.com:{owner}/{repo}[.git]
  const ssh = url.match(
    /github\.com:(?<owner>[^/]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/
  );
  if (ssh?.groups) return { owner: ssh.groups.owner, repo: ssh.groups.repo };
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
  reviews: { author: { login: string } | null; state: string }[]
): PullRequestReviewer[] {
  const byUser = new Map<string, { login: string; state: string }>();
  for (const r of reviews) {
    if (!r.author) continue;
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
          headRefOid
          url
          author { login }
          isDraft
          reviews(last: 100) {
            nodes {
              author { login }
              state
            }
          }
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                ... on User { login }
                ... on Team { name }
              }
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
  headRefOid: string;
  url: string;
  author: { login: string } | null;
  isDraft: boolean;
  reviews: {
    nodes: { author: { login: string } | null; state: string }[];
  };
  reviewRequests: {
    nodes: {
      requestedReviewer: { login?: string; name?: string } | null;
    }[];
  };
  reviewThreads: {
    nodes: { isResolved: boolean }[];
  };
  commits: {
    nodes: {
      commit: {
        statusCheckRollup: { state: string } | null;
      };
    }[];
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
  const reviewers = latestReviewPerUser(node.reviews.nodes);

  // Merge requested reviewers who haven't submitted a review yet
  const reviewedLogins = new Set(
    reviewers.map((r) => r.identifier.toLowerCase())
  );
  for (const req of node.reviewRequests.nodes) {
    const login = req.requestedReviewer?.login;
    if (login && !reviewedLogins.has(login.toLowerCase())) {
      reviewers.push({
        displayName: login,
        identifier: login,
        decision: 'no-response',
      });
    }
  }

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
    createdByIdentifier: node.author?.login ?? '',
    createdByDisplayName: node.author?.login ?? '',
    isDraft: node.isDraft,
    reviewers,
    buildStatus,
    activeCommentCount: unresolvedCount,
    headSha: node.headRefOid,
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

// ── Comment threads GraphQL ──────────────────────────────────────────

const FETCH_PR_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $prNumber: Int!, $threadCursor: String, $commentCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        id
        reviewThreads(first: 100, after: $threadCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            startLine
            originalLine
            originalStartLine
            diffSide
            comments(first: 100) {
              nodes {
                id
                author { login }
                body
                createdAt
                isMinimized
              }
            }
          }
        }
        comments(first: 100, after: $commentCursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            author { login }
            body
            createdAt
          }
        }
      }
    }
  }
`;

interface ThreadCommentNode {
  id: string;
  author: { login: string } | null;
  body: string;
  createdAt: string;
  isMinimized?: boolean;
}

interface ReviewThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  comments: {
    nodes: ThreadCommentNode[];
  };
}

interface GeneralCommentNode {
  id: string;
  author: { login: string } | null;
  body: string;
  createdAt: string;
}

interface FetchPrThreadsResponse {
  data: {
    repository: {
      pullRequest: {
        id: string;
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: ReviewThreadNode[];
        };
        comments: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GeneralCommentNode[];
        };
      };
    };
  };
}

function transformReviewThread(node: ReviewThreadNode): RemoteCommentThread {
  // For outdated threads GitHub returns `line: null` because the
  // commented line no longer exists at HEAD. Fall back to
  // `originalLine` so the thread can still be placed inline at the
  // line it was originally anchored to — otherwise it would land in
  // the "comments on lines not in diff" tail and be invisible to
  // anyone who doesn't scroll past the file.
  const effectiveLine = node.line ?? node.originalLine;
  const effectiveStart = node.startLine ?? node.originalStartLine;
  return {
    id: node.id,
    file: node.path,
    lineStart: effectiveStart ?? effectiveLine,
    lineEnd: effectiveLine,
    side: node.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT',
    isResolved: node.isResolved,
    isOutdated: node.isOutdated,
    canResolve: true,
    comments: node.comments.nodes.map(
      (c): RemoteCommentReply => ({
        id: c.id,
        author: c.author?.login ?? 'unknown',
        body: c.body,
        createdAt: c.createdAt,
        isMinimized: c.isMinimized,
      })
    ),
  };
}

function transformGeneralComment(
  node: GeneralCommentNode,
  prNodeId: string
): RemoteCommentThread {
  return {
    id: node.id,
    file: null,
    lineStart: null,
    lineEnd: null,
    side: 'RIGHT',
    isResolved: false,
    isOutdated: false,
    // GitHub issue comments have no resolve concept.
    canResolve: false,
    // Replies need the PR node id as the `subjectId` of the
    // `addComment` mutation (you can't reply to the comment itself —
    // you add another comment to the same subject).
    replyKind: 'github-issue-comment',
    replySubjectId: prNodeId,
    comments: [
      {
        id: node.id,
        author: node.author?.login ?? 'unknown',
        body: node.body,
        createdAt: node.createdAt,
      },
    ],
  };
}

async function fetchCommentThreadsGitHub(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PullRequestComments> {
  const threads: RemoteCommentThread[] = [];
  const generalComments: RemoteCommentThread[] = [];
  let threadCursor: string | undefined;
  let commentCursor: string | undefined;
  let needThreads = true;
  let needComments = true;

  // Paginate both review threads and general comments
  while (needThreads || needComments) {
    const variables: Record<string, string | number> = {
      owner,
      repo,
      prNumber,
    };
    if (threadCursor) variables.threadCursor = threadCursor;
    if (commentCursor) variables.commentCursor = commentCursor;

    const result = (await ghGraphQL(
      FETCH_PR_THREADS_QUERY,
      variables
    )) as FetchPrThreadsResponse;

    const pr = result.data.repository.pullRequest;

    // Process review threads
    if (needThreads) {
      for (const node of pr.reviewThreads.nodes) {
        threads.push(transformReviewThread(node));
      }
      if (
        pr.reviewThreads.pageInfo.hasNextPage &&
        pr.reviewThreads.pageInfo.endCursor
      ) {
        threadCursor = pr.reviewThreads.pageInfo.endCursor;
      } else {
        needThreads = false;
      }
    }

    // Process general comments
    if (needComments) {
      for (const node of pr.comments.nodes) {
        generalComments.push(transformGeneralComment(node, pr.id));
      }
      if (pr.comments.pageInfo.hasNextPage && pr.comments.pageInfo.endCursor) {
        commentCursor = pr.comments.pageInfo.endCursor;
      } else {
        needComments = false;
      }
    }
  }

  return { threads, generalComments };
}

// ── Comment mutations ───────────────────────────────────────────────

const REPLY_TO_THREAD_MUTATION = `
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {
      pullRequestReviewThreadId: $threadId
      body: $body
    }) {
      comment {
        id
        body
        createdAt
        author { login }
      }
    }
  }
`;

// General PR comments (GitHub issue-comment nodes) aren't on a review
// thread — replying means adding a sibling comment to the same PR
// subject. `subjectId` is the PR's GraphQL node id, captured at fetch
// time into the thread's `replySubjectId` field.
const ADD_PR_COMMENT_MUTATION = `
  mutation($subjectId: ID!, $body: String!) {
    addComment(input: { subjectId: $subjectId, body: $body }) {
      commentEdge {
        node {
          id
          body
          createdAt
          author { login }
        }
      }
    }
  }
`;

interface ReplyMutationResponse {
  data: {
    addPullRequestReviewThreadReply: {
      comment: {
        id: string;
        body: string;
        createdAt: string;
        author: { login: string } | null;
      };
    };
  };
}

interface AddCommentMutationResponse {
  data: {
    addComment: {
      commentEdge: {
        node: {
          id: string;
          body: string;
          createdAt: string;
          author: { login: string } | null;
        };
      };
    };
  };
}

const RESOLVE_THREAD_MUTATION = `
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;

const UNRESOLVE_THREAD_MUTATION = `
  mutation($threadId: ID!) {
    unresolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
`;

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

  autoDetectFields(): Record<string, string> | null {
    try {
      const out = execSync('gh api /user', {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const { login } = JSON.parse(out);
      if (login) return { username: login };
    } catch {
      // gh not installed or not authenticated
    }
    return null;
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

  async fetchCommentThreads(
    _auth: Record<string, string>,
    project: Record<string, string>,
    prId: number
  ): Promise<PullRequestComments> {
    const { owner, repo } = project;
    if (!owner || !repo) return { threads: [], generalComments: [] };
    return fetchCommentThreadsGitHub(owner, repo, prId);
  },

  async replyToThread(
    _auth: Record<string, string>,
    _project: Record<string, string>,
    _prId: number,
    thread: RemoteCommentThread,
    body: string
  ): Promise<RemoteCommentReply> {
    if (thread.replyKind === 'github-issue-comment') {
      if (!thread.replySubjectId) {
        throw new Error(
          'Cannot reply to GitHub issue comment: missing replySubjectId'
        );
      }
      const result = (await ghGraphQL(ADD_PR_COMMENT_MUTATION, {
        subjectId: thread.replySubjectId,
        body,
      })) as AddCommentMutationResponse;
      const c = result.data.addComment.commentEdge.node;
      return {
        id: c.id,
        author: c.author?.login ?? 'unknown',
        body: c.body,
        createdAt: c.createdAt,
      };
    }
    const result = (await ghGraphQL(REPLY_TO_THREAD_MUTATION, {
      threadId: thread.id,
      body,
    })) as ReplyMutationResponse;
    const c = result.data.addPullRequestReviewThreadReply.comment;
    return {
      id: c.id,
      author: c.author?.login ?? 'unknown',
      body: c.body,
      createdAt: c.createdAt,
    };
  },

  async setThreadResolved(
    _auth: Record<string, string>,
    _project: Record<string, string>,
    _prId: number,
    thread: RemoteCommentThread,
    resolved: boolean
  ): Promise<void> {
    if (!thread.canResolve) return;
    const mutation = resolved
      ? RESOLVE_THREAD_MUTATION
      : UNRESOLVE_THREAD_MUTATION;
    await ghGraphQL(mutation, { threadId: thread.id });
  },
};
