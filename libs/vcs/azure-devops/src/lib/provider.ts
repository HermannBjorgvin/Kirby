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

// ── @mention resolution (GUID → display name) ──────────────────────
//
// ADO's REST API returns comment bodies with raw `@<GUID>` tokens
// where the web UI renders `@<Display Name>`. Kirby post-processes
// fetched comment bodies: extracts mention GUIDs, batch-resolves them
// against the ADO Identities API, caches the results, and substitutes
// the tokens inline before handing off to the renderer.
//
// Fallback: if the API call fails OR a specific GUID doesn't resolve,
// the original `@<GUID>` stays put. Better to show the UUID than to
// silently drop the reference.

const MENTION_GUID_RE =
  /@<([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/gi;

/** Extract unique mention GUIDs from a comment body, lowercased. */
export function extractMentionGuids(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_GUID_RE)) {
    seen.add(m[1]!.toLowerCase());
  }
  return [...seen];
}

/**
 * Substitute `@<guid>` tokens with `@<displayName>` using the provided
 * cache. Unresolved GUIDs stay intact (the whole `@<GUID>` token,
 * including the angle brackets) so no reference silently disappears.
 */
export function rewriteMentions(
  text: string,
  cache: Map<string, string>
): string {
  return text.replace(MENTION_GUID_RE, (orig, guid: string) => {
    const name = cache.get(guid.toLowerCase());
    return name ? `@${name}` : orig;
  });
}

// Module-level cache shared across provider calls. TTL matches the
// identity cache above — identities change rarely and a stale name is
// a better failure mode than a rate-limited API.
const mentionCache = new Map<string, string>();
let mentionCacheFetchedAt = 0;
const MENTION_CACHE_TTL_MS = 30 * 60 * 1000;

/** Test helper — resets the module-level cache. */
export function _clearMentionCacheForTests(): void {
  mentionCache.clear();
  mentionCacheFetchedAt = 0;
}

interface AdoIdentity {
  id?: string;
  providerDisplayName?: string;
  customDisplayName?: string;
}

/**
 * Batch-resolve GUIDs via ADO's Identities API
 * (https://vssps.dev.azure.com/{org}/_apis/identities). Updates the
 * module-level cache in place. Unresolved GUIDs are NOT cached, so a
 * later retry has a chance to pick them up.
 */
async function resolveMentionNames(
  config: AdoConfig,
  guids: string[]
): Promise<void> {
  if (guids.length === 0) return;
  if (Date.now() - mentionCacheFetchedAt > MENTION_CACHE_TTL_MS) {
    mentionCache.clear();
    mentionCacheFetchedAt = Date.now();
  }
  const uncached = guids.filter((g) => !mentionCache.has(g));
  if (uncached.length === 0) return;

  const url = `https://vssps.dev.azure.com/${
    config.org
  }/_apis/identities?identityIds=${uncached.join(',')}&api-version=7.1`;
  try {
    const res = await fetch(url, { headers: authHeaders(config.pat) });
    if (!res.ok) return;
    const data = (await res.json()) as { value?: AdoIdentity[] };
    for (const identity of data.value ?? []) {
      const id = identity.id?.toLowerCase();
      const name =
        identity.providerDisplayName ?? identity.customDisplayName ?? '';
      if (id && name) mentionCache.set(id, name);
    }
    if (mentionCacheFetchedAt === 0) mentionCacheFetchedAt = Date.now();
  } catch {
    // Network failure — leave cache as-is. `rewriteMentions` falls back
    // to the original `@<GUID>` for anything it can't resolve.
  }
}

// ── Comment thread helpers ──────────────────────────────────────────

interface AdoThreadComment {
  id?: number;
  author?: { displayName?: string; uniqueName?: string };
  content?: string;
  publishedDate?: string;
  commentType?: string;
}

interface AdoLineRef {
  line?: number;
}

interface AdoThread {
  id?: number;
  status?: string;
  threadContext?: {
    filePath?: string;
    rightFileStart?: AdoLineRef;
    rightFileEnd?: AdoLineRef;
    leftFileStart?: AdoLineRef;
    leftFileEnd?: AdoLineRef;
  };
  /** Iteration-tracking metadata. When the diff has changed since
   *  the comment was made and ADO can't track the line forward, the
   *  current `threadContext` lines may be null while the originals
   *  here remain — same idea as GitHub's `originalLine`. */
  pullRequestThreadContext?: {
    trackingCriteria?: {
      origLeftFileStart?: AdoLineRef;
      origLeftFileEnd?: AdoLineRef;
      origRightFileStart?: AdoLineRef;
      origRightFileEnd?: AdoLineRef;
    };
  };
  comments?: AdoThreadComment[];
  properties?: Record<string, unknown>;
}

function adoStatusToResolved(status: string | undefined): boolean {
  // ADO thread statuses: active=1, fixed=2, wontFix=3, closed=4, byDesign=5, pending=6
  // Only fixed/wontFix/closed/byDesign are genuinely resolved; pending means
  // the author hasn't decided yet and should be treated as open.
  return (
    status === 'fixed' ||
    status === 'wontFix' ||
    status === 'closed' ||
    status === 'byDesign'
  );
}

function transformAdoThread(thread: AdoThread): RemoteCommentThread | null {
  const humanComments = (thread.comments ?? []).filter(
    (c) => c.commentType !== 'system'
  );
  if (humanComments.length === 0) return null;

  const ctx = thread.threadContext;
  const hasFile = ctx?.filePath != null;
  const orig = thread.pullRequestThreadContext?.trackingCriteria;

  // Resolve current vs. original line refs per side. ADO can keep
  // `threadContext` populated across iterations, but when the line a
  // thread was anchored to is removed in a later push, the current
  // ref goes null and only `trackingCriteria.orig*` survives. Mirrors
  // GitHub's `originalLine` fallback so outdated threads still render
  // inline at the line they were originally placed on.
  const leftStart = ctx?.leftFileStart?.line ?? orig?.origLeftFileStart?.line;
  const leftEnd = ctx?.leftFileEnd?.line ?? orig?.origLeftFileEnd?.line;
  const rightStart =
    ctx?.rightFileStart?.line ?? orig?.origRightFileStart?.line;
  const rightEnd = ctx?.rightFileEnd?.line ?? orig?.origRightFileEnd?.line;

  // Side selection: LEFT when the thread is anchored to a deleted/old
  // line (left side has a ref, right side doesn't) — same heuristic
  // as before, but applied to the resolved (current OR original) refs.
  const isLeftSide = leftStart != null && rightStart == null;

  // We hit the outdated path when the current threadContext was null
  // and we had to read from trackingCriteria. Set isOutdated so the
  // card shows the dim "(outdated)" tag.
  const usedFallback =
    (ctx?.leftFileStart?.line == null && leftStart != null) ||
    (ctx?.rightFileStart?.line == null && rightStart != null);

  return {
    id: String(thread.id ?? ''),
    file: hasFile ? ctx!.filePath!.replace(/^\//, '') ?? null : null,
    lineStart: isLeftSide ? leftStart ?? null : rightStart ?? null,
    lineEnd: isLeftSide ? leftEnd ?? null : rightEnd ?? null,
    side: isLeftSide ? 'LEFT' : 'RIGHT',
    isResolved: adoStatusToResolved(thread.status),
    isOutdated: usedFallback,
    // All ADO threads (inline + general) share the same thread
    // resource and support status transitions.
    canResolve: true,
    comments: humanComments.map(
      (c): RemoteCommentReply => ({
        id: String(c.id ?? ''),
        author: c.author?.displayName ?? c.author?.uniqueName ?? 'unknown',
        body: c.content ?? '',
        createdAt: c.publishedDate ?? '',
      })
    ),
  };
}

async function fetchAdoCommentThreads(
  config: AdoConfig,
  prId: number
): Promise<PullRequestComments> {
  const url = `${baseUrl(config)}/pullrequests/${prId}/threads?api-version=7.1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${res.statusText}`);
  }
  const data = (await res.json()) as { value?: AdoThread[] };

  const threads: RemoteCommentThread[] = [];
  const generalComments: RemoteCommentThread[] = [];

  for (const raw of data.value ?? []) {
    const thread = transformAdoThread(raw);
    if (!thread) continue;

    if (thread.file === null) {
      generalComments.push(thread);
    } else {
      threads.push(thread);
    }
  }

  // Collect mention GUIDs across every comment body in one sweep so
  // the Identities API gets a single batched call per poll. Rewrite
  // bodies in place once the cache is warm.
  const allGuids = new Set<string>();
  const collect = (t: RemoteCommentThread): void => {
    for (const c of t.comments) {
      for (const g of extractMentionGuids(c.body)) allGuids.add(g);
    }
  };
  threads.forEach(collect);
  generalComments.forEach(collect);

  if (allGuids.size > 0) {
    await resolveMentionNames(config, [...allGuids]);
    const rewriteThread = (t: RemoteCommentThread): RemoteCommentThread => ({
      ...t,
      comments: t.comments.map((c) => ({
        ...c,
        body: rewriteMentions(c.body, mentionCache),
      })),
    });
    return {
      threads: threads.map(rewriteThread),
      generalComments: generalComments.map(rewriteThread),
    };
  }

  return { threads, generalComments };
}

async function replyToAdoThread(
  config: AdoConfig,
  prId: number,
  threadId: string,
  body: string
): Promise<RemoteCommentReply> {
  // Resolve the root comment's ID so we can attach the reply to it
  // properly. ADO uses `parentCommentId` to render threading in the
  // web UI: `0` means "this IS the root comment of the thread", so
  // passing `0` for a reply makes it show up as an additional top-
  // level comment rather than as a reply underneath the original.
  // That's invisible in Kirby (flat rendering) but visible — and
  // confusing — to anyone reviewing the PR in ADO's web UI.
  const threadUrl = `${baseUrl(
    config
  )}/pullrequests/${prId}/threads/${threadId}?api-version=7.1`;
  const threadRes = await fetch(threadUrl, {
    headers: authHeaders(config.pat),
  });
  if (!threadRes.ok) {
    throw new Error(
      `ADO API error ${threadRes.status}: ${threadRes.statusText}`
    );
  }
  const thread = (await threadRes.json()) as AdoThread;
  const rootComment = (thread.comments ?? []).find(
    (c) => c.commentType !== 'system'
  );
  // Fallback to 0 if we somehow can't find a non-system root (e.g. a
  // thread that only contains system comments): posting still works,
  // just without nesting.
  const parentCommentId =
    typeof rootComment?.id === 'number' ? rootComment.id : 0;

  const url = `${baseUrl(
    config
  )}/pullrequests/${prId}/threads/${threadId}/comments?api-version=7.1`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(config.pat),
    body: JSON.stringify({
      parentCommentId,
      content: body,
      commentType: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as AdoThreadComment;
  return {
    id: String(data.id ?? ''),
    author: data.author?.displayName ?? data.author?.uniqueName ?? 'unknown',
    body: data.content ?? '',
    createdAt: data.publishedDate ?? '',
  };
}

async function setAdoThreadResolved(
  config: AdoConfig,
  prId: number,
  threadId: string,
  resolved: boolean
): Promise<void> {
  const url = `${baseUrl(
    config
  )}/pullrequests/${prId}/threads/${threadId}?api-version=7.1`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(config.pat),
    body: JSON.stringify({
      status: resolved ? 2 : 1, // 2 = fixed, 1 = active
    }),
  });
  if (!res.ok) {
    throw new Error(`ADO API error ${res.status}: ${await res.text()}`);
  }
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

  async fetchCommentThreads(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number
  ): Promise<PullRequestComments> {
    const config = toAdoConfig(auth, project);
    return fetchAdoCommentThreads(config, prId);
  },

  async replyToThread(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    thread: RemoteCommentThread,
    body: string
  ): Promise<RemoteCommentReply> {
    const config = toAdoConfig(auth, project);
    return replyToAdoThread(config, prId, thread.id, body);
  },

  async setThreadResolved(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    thread: RemoteCommentThread,
    resolved: boolean
  ): Promise<void> {
    if (!thread.canResolve) return;
    const config = toAdoConfig(auth, project);
    await setAdoThreadResolved(config, prId, thread.id, resolved);
  },
};
