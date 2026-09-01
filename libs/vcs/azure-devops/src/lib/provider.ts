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
  ReviewVerdict,
  BuildStatusState,
} from '@kirby/vcs-core';
import { sanitizeBody } from '@kirby/vcs-core';
import { log } from '@kirby/logger';
import type { AdoConfig } from './client.js';
import { authHeaders, baseUrl } from './client.js';
import {
  adoGet,
  adoSend,
  counted,
  invalidateAdoCache,
  invalidateAdoKey,
  resetAdoTransport,
  TTL,
} from './request.js';
import { combineBuildStatus, fetchPrBuildStatus } from './build-status.js';
import { fetchPrBuildRunsBatch } from './builds.js';

// ── Internal ADO types ─────────────────────────────────────────────

type ReviewerVote = 10 | 5 | 0 | -5 | -10;

interface RawReviewer {
  displayName?: string;
  uniqueName?: string;
  id?: string;
  vote?: number;
  hasDeclined?: boolean;
  isContainer?: boolean;
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

/** Everything the transport has cached about one pull request. Called
 *  after a write so the change is visible immediately rather than at
 *  the end of the entry's TTL.
 *
 *  Exact keys, not prefixes: `.../threads/1` is a prefix of
 *  `.../threads/10`, so replying on pull request 1 would otherwise
 *  drop the cached threads of 10 through 19 and 100 through 199 too.
 *  The individual-thread keys carry a further segment, so those are
 *  the one place a prefix is meant — and it ends at the separator. */
function invalidatePr(config: AdoConfig, prId: number): void {
  const repo = `${config.org}/${config.project}/${config.repo}`;
  invalidateAdoKey(`${repo}/threads/${prId}`);
  invalidateAdoKey(`${repo}/statuses/${prId}`);
  invalidateAdoKey(`${repo}/description/${prId}`);
  invalidateAdoCache(`${repo}/thread/${prId}/`);
}

function voteToDecision(vote: number, hasDeclined: boolean): ReviewDecision {
  if (hasDeclined) return 'declined';
  if (vote === 10 || vote === 5) return 'approved';
  if (vote === -5) return 'waiting-for-author';
  if (vote === -10) return 'rejected';
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

interface ConnectionData {
  authenticatedUser?: {
    id?: string;
    properties?: { Account?: { $value?: string } };
  };
}

/** `/connectiondata` answers both "who am I" questions, so one cached
 *  read serves the email and the identity GUID alike. */
function fetchConnectionData(config: AdoConfig): Promise<ConnectionData> {
  return adoGet<ConnectionData>(
    'fetchConnectionData',
    `${config.org}/connectiondata`,
    TTL.identity,
    `https://dev.azure.com/${config.org}/_apis/connectiondata?api-version=7.1-preview`,
    authHeaders(config.pat),
    `organization ${config.org}`
  );
}

export async function fetchAuthenticatedUserEmail(
  config: AdoConfig
): Promise<string> {
  const data = await fetchConnectionData(config);
  return data.authenticatedUser?.properties?.Account?.$value ?? '';
}

/** The authenticated user's identity GUID — needed to cast a reviewer
 *  vote, since the reviewers endpoint has no "me" alias. */
export async function fetchAuthenticatedUserId(
  config: AdoConfig
): Promise<string> {
  const data = await fetchConnectionData(config);
  const id = data.authenticatedUser?.id;
  if (!id) throw new Error('Could not resolve the authenticated ADO user id');
  return id;
}

export async function fetchMyTeamIds(config: AdoConfig): Promise<Set<string>> {
  try {
    const data = await adoGet<{ value?: { id?: string }[] }>(
      'fetchMyTeamIds',
      `${config.org}/${config.project}/my-teams`,
      TTL.identity,
      `https://dev.azure.com/${config.org}/_apis/projects/${config.project}/teams?$mine=true&api-version=7.1`,
      authHeaders(config.pat),
      `teams in ${config.project}`
    );
    return new Set(
      (data.value ?? []).map((t) => t.id).filter((id): id is string => !!id)
    );
  } catch {
    // Team membership only enriches reviewer rows; a failure here must
    // not take the pull request list down with it.
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
  const data = await adoGet<{ value?: unknown[] }>(
    'fetchActivePullRequests',
    `${config.org}/${config.project}/${config.repo}/active-prs`,
    // Dedupe only: both shells already decide how often to ask, and
    // caching here would silently override the poll interval they set.
    0,
    `${baseUrl(
      config
    )}/pullrequests?searchCriteria.status=active&api-version=7.1`,
    authHeaders(config.pat),
    `repository ${config.repo}`
  );
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

/**
 * A pull request's threads, exactly once per TTL however many callers
 * want them.
 *
 * The sidebar needs a count and the review workspace needs the threads
 * themselves, and both were reading the same endpoint independently —
 * so opening a pull request refetched what the sidebar had just
 * fetched, on every poll, for every row.
 */
function fetchRawThreads(
  config: AdoConfig,
  prId: number
): Promise<{ value?: AdoThread[] }> {
  return adoGet<{ value?: AdoThread[] }>(
    'fetchThreads',
    `${config.org}/${config.project}/${config.repo}/threads/${prId}`,
    TTL.threads,
    `${baseUrl(config)}/pullrequests/${prId}/threads?api-version=7.1`,
    authHeaders(config.pat),
    `pull request ${prId}`
  );
}

export async function fetchActiveCommentCount(
  config: AdoConfig,
  prId: number
): Promise<number> {
  const data = await fetchRawThreads(config, prId);
  return countActiveThreads(data.value ?? []);
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

// ── Identity ────────────────────────────────────────────────────────

/** Who we are and which teams we are in. Both reads are cached by the
 *  shared transport at `TTL.identity`, so this is a memory lookup on
 *  every poll but the first of each half hour. */
async function getCachedIdentity(
  config: AdoConfig
): Promise<{ userEmail: string; myTeamIds: Set<string> }> {
  const [userEmail, myTeamIds] = await Promise.all([
    fetchAuthenticatedUserEmail(config).catch(() => ''),
    fetchMyTeamIds(config),
  ]);
  return { userEmail, myTeamIds };
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
/**
 * Fold an identities response into the cache. An entry with no id or
 * no usable display name is skipped rather than cached blank, so a
 * later fetch can still resolve it.
 */
function cacheIdentities(identities: AdoIdentity[]): void {
  for (const identity of identities) {
    const id = identity.id?.toLowerCase();
    const name =
      identity.providerDisplayName ?? identity.customDisplayName ?? '';
    if (id && name) mentionCache.set(id, name);
  }
}

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

  const ids = uncached.join(',');
  try {
    const data = await adoGet<{ value?: AdoIdentity[] }>(
      'resolveMentionNames',
      `${config.org}/identities/${ids}`,
      TTL.identity,
      `https://vssps.dev.azure.com/${config.org}/_apis/identities?identityIds=${ids}&api-version=7.1`,
      authHeaders(config.pat),
      'those identities'
    );
    cacheIdentities(data.value ?? []);
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

/**
 * Sanitized snapshot of an ADO thread for diagnostic logging. Strips
 * comment bodies (reviewer text, noisy) and author names (PII), keeping
 * only the structural fields needed to reproduce a placement bug. Set
 * `KIRBY_LOG=/path/to/log` to capture; safe to share in bug reports.
 */
function sanitizeAdoThreadForLog(thread: AdoThread): unknown {
  return {
    id: thread.id,
    status: thread.status,
    threadContext: thread.threadContext
      ? {
          filePath: thread.threadContext.filePath,
          leftFileStart: thread.threadContext.leftFileStart,
          leftFileEnd: thread.threadContext.leftFileEnd,
          rightFileStart: thread.threadContext.rightFileStart,
          rightFileEnd: thread.threadContext.rightFileEnd,
        }
      : null,
    pullRequestThreadContext: thread.pullRequestThreadContext ?? null,
    commentTypes: (thread.comments ?? []).map((c) => c.commentType ?? 'text'),
  };
}

/**
 * A line ref as it stands now, or the one ADO recorded when it could
 * still track the line.
 *
 * ADO keeps `threadContext` populated across iterations, but when the
 * line a thread was anchored to is removed in a later push the current
 * ref goes null and only `trackingCriteria.orig*` survives. Mirrors
 * GitHub's `originalLine` fallback so outdated threads still render
 * inline at the line they were originally placed on.
 */
function trackedLine(
  current: AdoLineRef | undefined,
  original: AdoLineRef | undefined
): number | undefined {
  return current?.line ?? original?.line;
}

/** True when a line could only be recovered from the tracking
 *  metadata — which is what makes a thread outdated. */
function cameFromTracking(
  current: AdoLineRef | undefined,
  resolved: number | undefined
): boolean {
  return current?.line == null && resolved != null;
}

/** A thread's four line refs, resolved current-or-original. */
interface ThreadLines {
  leftStart: number | undefined;
  leftEnd: number | undefined;
  rightStart: number | undefined;
  rightEnd: number | undefined;
  usedFallback: boolean;
}

function resolveThreadLines(thread: AdoThread): ThreadLines {
  // Both bags are optional and every field inside them is too, so an
  // empty object stands in for a missing one — that keeps this a table
  // of four lookups instead of eight optional chains.
  const ctx: NonNullable<AdoThread['threadContext']> =
    thread.threadContext ?? {};
  const orig: NonNullable<
    NonNullable<AdoThread['pullRequestThreadContext']>['trackingCriteria']
  > = thread.pullRequestThreadContext?.trackingCriteria ?? {};
  const leftStart = trackedLine(ctx.leftFileStart, orig.origLeftFileStart);
  const leftEnd = trackedLine(ctx.leftFileEnd, orig.origLeftFileEnd);
  const rightStart = trackedLine(ctx.rightFileStart, orig.origRightFileStart);
  const rightEnd = trackedLine(ctx.rightFileEnd, orig.origRightFileEnd);
  return {
    leftStart,
    leftEnd,
    rightStart,
    rightEnd,
    usedFallback:
      cameFromTracking(ctx.leftFileStart, leftStart) ||
      cameFromTracking(ctx.rightFileStart, rightStart),
  };
}

/** Where a thread renders in the diff. */
interface ThreadAnchor {
  lineStart: number | null;
  lineEnd: number | null;
  side: 'LEFT' | 'RIGHT';
  isOutdated: boolean;
  /** The intermediate values, carried through for the diagnostic log
   *  only — a misplaced comment is otherwise hard to reproduce. */
  trace: ThreadLines & { isLeftSide: boolean; fileLevelOnly: boolean };
}

function resolveThreadAnchor(
  thread: AdoThread,
  hasFile: boolean
): ThreadAnchor {
  const lines = resolveThreadLines(thread);
  const { leftStart, leftEnd, rightStart, rightEnd } = lines;

  // Side selection: LEFT when the thread is anchored to a deleted/old
  // line (left side has a ref, right side doesn't), applied to the
  // resolved (current OR original) refs.
  const isLeftSide = leftStart != null && rightStart == null;

  // ADO sometimes returns a file-anchored thread with NO line refs
  // anywhere — `threadContext` has `filePath` but every `*FileStart/End`
  // is undefined, and `pullRequestThreadContext.trackingCriteria` (which
  // would carry the originals) is omitted. The docs note trackingCriteria
  // is "not returned/sent if not needed", and ADO's heuristic for "not
  // needed" doesn't always match the user's intuition.
  //
  // Without a fallback these threads land in the out-of-diff tail and
  // the user has to scroll the whole file to find them. Treat as an
  // outdated file-level thread: anchor to line 1 (-U99999 always has it
  // as a context line) and flag isOutdated so the card surfaces with
  // the dim "(outdated)" tag at the top of the file diff.
  const fileLevelOnly =
    hasFile &&
    leftStart == null &&
    leftEnd == null &&
    rightStart == null &&
    rightEnd == null;

  const trace = { ...lines, isLeftSide, fileLevelOnly };
  if (fileLevelOnly) {
    return { lineStart: 1, lineEnd: 1, side: 'RIGHT', isOutdated: true, trace };
  }
  const start = isLeftSide ? leftStart : rightStart;
  const end = isLeftSide ? leftEnd : rightEnd;
  return {
    lineStart: start ?? null,
    lineEnd: end ?? null,
    side: isLeftSide ? 'LEFT' : 'RIGHT',
    // We hit the outdated path when the current threadContext was null
    // and we had to read from trackingCriteria. The card then shows the
    // dim "(outdated)" tag.
    isOutdated: lines.usedFallback,
    trace,
  };
}

function toRemoteReply(comment: AdoThreadComment): RemoteCommentReply {
  return {
    id: String(comment.id ?? ''),
    author:
      comment.author?.displayName ?? comment.author?.uniqueName ?? 'unknown',
    body: sanitizeBody(comment.content ?? ''),
    createdAt: comment.publishedDate ?? '',
  };
}

function transformAdoThread(thread: AdoThread): RemoteCommentThread | null {
  const humanComments = (thread.comments ?? []).filter(
    (c) => c.commentType !== 'system'
  );
  if (humanComments.length === 0) {
    log(
      'info',
      'ado.transformThread',
      `thread ${thread.id} dropped (no human comments)`,
      { raw: sanitizeAdoThreadForLog(thread) }
    );
    return null;
  }

  const ctx = thread.threadContext;
  const hasFile = ctx?.filePath != null;
  const anchor = resolveThreadAnchor(thread, hasFile);

  const result: RemoteCommentThread = {
    id: String(thread.id ?? ''),
    file: hasFile ? ctx!.filePath!.replace(/^\//, '') : null,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
    side: anchor.side,
    isResolved: adoStatusToResolved(thread.status),
    isOutdated: anchor.isOutdated,
    // All ADO threads (inline + general) share the same thread
    // resource and support status transitions.
    canResolve: true,
    comments: humanComments.map(toRemoteReply),
  };

  log(
    'info',
    'ado.transformThread',
    `thread ${thread.id} → ${result.side} ${result.file}:${
      result.lineStart ?? '?'
    }-${result.lineEnd ?? '?'} outdated=${result.isOutdated}`,
    {
      raw: sanitizeAdoThreadForLog(thread),
      resolved: anchor.trace,
      output: {
        file: result.file,
        lineStart: result.lineStart,
        lineEnd: result.lineEnd,
        side: result.side,
        isOutdated: result.isOutdated,
        isResolved: result.isResolved,
      },
    }
  );

  return result;
}

async function fetchAdoCommentThreads(
  config: AdoConfig,
  prId: number
): Promise<PullRequestComments> {
  const data = await fetchRawThreads(config, prId);
  const rawCount = (data.value ?? []).length;
  log(
    'info',
    'ado.fetchThreads',
    `PR ${prId}: ${rawCount} raw threads from ADO`
  );

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

  log(
    'info',
    'ado.fetchThreads',
    `PR ${prId}: transform output → ${threads.length} file threads, ${generalComments.length} general`,
    {
      fileThreads: threads.map((t) => ({
        id: t.id,
        file: t.file,
        side: t.side,
        lineStart: t.lineStart,
        lineEnd: t.lineEnd,
        isOutdated: t.isOutdated,
        isResolved: t.isResolved,
      })),
      generalCount: generalComments.length,
    }
  );

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

/**
 * The comment id a reply should hang under. ADO renders threading from
 * `parentCommentId`, where `0` means "this IS the thread root" — so
 * replying with `0` posts an extra top-level comment instead of a
 * reply. That is invisible in Kirby's flat rendering and confusing to
 * anyone reading the pull request in ADO's web UI.
 *
 * Falling back to `0` covers a thread holding nothing but system
 * comments: the reply still posts, just unnested.
 */
async function resolveRootCommentId(
  config: AdoConfig,
  prId: number,
  threadId: string
): Promise<number> {
  const thread = await adoGet<AdoThread>(
    'replyToAdoThread:resolveRoot',
    `${config.org}/${config.project}/${config.repo}/thread/${prId}/${threadId}`,
    // A reply must hang off the thread as it stands now, not as it
    // stood when something else last read it.
    0,
    `${baseUrl(
      config
    )}/pullrequests/${prId}/threads/${threadId}?api-version=7.1`,
    authHeaders(config.pat),
    `thread ${threadId}`
  );
  const root = (thread.comments ?? []).find((c) => c.commentType !== 'system');
  return typeof root?.id === 'number' ? root.id : 0;
}

async function replyToAdoThread(
  config: AdoConfig,
  prId: number,
  threadId: string,
  body: string
): Promise<RemoteCommentReply> {
  const parentCommentId = await resolveRootCommentId(config, prId, threadId);

  const url = `${baseUrl(
    config
  )}/pullrequests/${prId}/threads/${threadId}/comments?api-version=7.1`;
  const posted = await adoSend<AdoThreadComment>(
    'replyToAdoThread:postComment',
    url,
    {
      method: 'POST',
      headers: authHeaders(config.pat),
      body: JSON.stringify({ parentCommentId, content: body, commentType: 1 }),
      bodyForLog: {
        parentCommentId,
        contentLength: body.length,
        commentType: 1,
      },
    }
  );
  // The thread we just changed is cached; leaving it would show the
  // reply only once the TTL lapsed.
  invalidatePr(config, prId);
  return toRemoteReply(posted);
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
  await adoSend<unknown>('setAdoThreadResolved', url, {
    method: 'PATCH',
    headers: authHeaders(config.pat),
    body: JSON.stringify({
      status: resolved ? 2 : 1, // 2 = fixed, 1 = active
    }),
    bodyForLog: { status: resolved ? 2 : 1, resolved },
  });
  invalidatePr(config, prId);
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

  resetCaches(): void {
    resetAdoTransport();
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

    return counted('fetchPullRequests', async () => {
      const { userEmail, myTeamIds } = await getCachedIdentity(config);
      const teamContext =
        userEmail && myTeamIds.size > 0 ? { myTeamIds, userEmail } : undefined;

      const prs = await fetchActivePullRequests(config, project, teamContext);

      // CI reaches a pull request by two unrelated routes and a repo
      // usually only uses one: pipelines run against the merge ref,
      // while other checks post to the status list. Reading only the
      // statuses showed no CI result for pull requests whose build had
      // plainly failed. A failure on either route is a failure.
      //
      // The runs for every row come back in one request; the status
      // list has no batch endpoint, so those stay per row and are
      // cached instead.
      const runVerdicts = await fetchPrBuildRunsBatch(
        config,
        prs.map((pr) => pr.id)
      ).catch(() => new Map<number, BuildStatusState>());

      const withDetails = await Promise.all(
        prs.map(async (pr) => {
          const [activeCommentCount, statusVerdict] = await Promise.all([
            fetchActiveCommentCount(config, pr.id),
            fetchPrBuildStatus(config, pr.id),
          ]);
          return {
            ...pr,
            activeCommentCount,
            buildStatus: combineBuildStatus(
              statusVerdict,
              runVerdicts.get(pr.id) ?? 'none'
            ),
          } satisfies PullRequestInfo;
        })
      );

      const map: BranchPrMap = {};
      for (const pr of withDetails) {
        map[pr.sourceBranch] = pr;
      }
      return map;
    });
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
    // A failed lookup answers with no merged branches rather than
    // throwing: the sweep that consumes this deletes branches, and
    // "the request failed" must never read as "nothing is merged".
    const data = await adoGet<{ value?: { sourceRefName?: string }[] }>(
      'fetchMergedBranches',
      `${config.org}/${config.project}/${config.repo}/completed-prs`,
      TTL.mergedPrs,
      `${baseUrl(
        config
      )}/pullrequests?searchCriteria.status=completed&api-version=7.1`,
      authHeaders(config.pat),
      `repository ${config.repo}`
    ).catch(() => ({ value: [] as { sourceRefName?: string }[] }));
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

  async fetchPullRequestDescription(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number
  ): Promise<string> {
    const config = toAdoConfig(auth, project);
    const data = await adoGet<{ description?: string }>(
      'fetchPullRequestDescription',
      `${config.org}/${config.project}/${config.repo}/description/${prId}`,
      TTL.description,
      `${baseUrl(config)}/pullrequests/${prId}?api-version=7.1`,
      authHeaders(config.pat),
      `pull request ${prId}`
    );
    return sanitizeBody(data.description ?? '');
  },

  async submitReviewVerdict(
    auth: Record<string, string>,
    project: Record<string, string>,
    prId: number,
    verdict: ReviewVerdict
  ): Promise<void> {
    const config = toAdoConfig(auth, project);
    const userId = await fetchAuthenticatedUserId(config);
    const votes: Record<ReviewVerdict, ReviewerVote> = {
      approve: 10,
      'approve-with-suggestions': 5,
      'wait-for-author': -5,
      reject: -10,
    };
    const vote = votes[verdict];
    const url = `${baseUrl(
      config
    )}/pullrequests/${prId}/reviewers/${userId}?api-version=7.1`;
    await adoSend<unknown>('submitReviewVerdict', url, {
      method: 'PUT',
      headers: authHeaders(config.pat),
      body: JSON.stringify({ id: userId, vote }),
      bodyForLog: { vote },
    });
    // Nothing cached here carries a reviewer vote: the list that does
    // is fetched with a zero TTL, so it is deduped and never stored.
    // Wiping the repository prefix would therefore drop threads,
    // statuses and descriptions to fix something they do not hold.
    // The vote a user might still see is in the shell's own model —
    // the desktop refreshes it from services/reviews.ts.
  },
};
