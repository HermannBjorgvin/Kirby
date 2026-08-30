import { readConfig } from '@kirby/vcs-core';
import type {
  BranchPrMap,
  PullRequestComments,
  ReviewVerdict,
} from '@kirby/vcs-core';
import { fetchDiffText, fetchFileDiffText } from '@kirby/core';
import { PROVIDERS, requireRepo } from './repo.js';
import type { ReplyRequest, ResolveRequest } from '../contract.js';

interface ActiveProvider {
  fetchPullRequests(): Promise<BranchPrMap>;
  fetchCommentThreads(prId: number): Promise<PullRequestComments>;
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
  fetchPrDescription(prId: number): Promise<string>;
  submitReviewVerdict(prId: number, verdict: ReviewVerdict): Promise<void>;
}

/**
 * Resolve the configured VCS provider for the active repo and check
 * it is fully authenticated before doing any network work.
 */
/**
 * Resolves the configured provider, or null when the repo has none /
 * it isn't fully authenticated. Bare repos are first-class: review
 * features simply degrade, mirroring the TUI's usePrData.
 */
function resolveProvider(): ActiveProvider | null {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
  if (!provider) return null;
  if (!provider.isConfigured(config.vendorAuth, config.vendorProject)) {
    return null;
  }
  const { vendorAuth: auth, vendorProject: project } = config;
  return {
    fetchPullRequests: () => provider.fetchPullRequests(auth, project),
    fetchCommentThreads: (prId) => {
      if (!provider.fetchCommentThreads) {
        throw new Error(`Provider ${provider.id} does not support comments`);
      }
      return provider.fetchCommentThreads(auth, project, prId);
    },
    replyToThread: ({ prId, thread, body }) => {
      if (!provider.replyToThread) {
        throw new Error(`Provider ${provider.id} does not support replies`);
      }
      return provider
        .replyToThread(auth, project, prId, thread, body)
        .then(() => undefined);
    },
    setThreadResolved: ({ prId, thread, resolved }) => {
      if (!provider.setThreadResolved) {
        throw new Error(
          `Provider ${provider.id} does not support thread resolution`
        );
      }
      return provider.setThreadResolved(auth, project, prId, thread, resolved);
    },
    fetchPrDescription: (prId) => {
      if (!provider.fetchPullRequestDescription) return Promise.resolve('');
      return provider.fetchPullRequestDescription(auth, project, prId);
    },
    submitReviewVerdict: (prId, verdict) => {
      if (!provider.submitReviewVerdict) {
        throw new Error(
          `Provider ${provider.id} does not support review verdicts`
        );
      }
      return provider.submitReviewVerdict(auth, project, prId, verdict);
    },
  };
}

export async function fetchPullRequests(): Promise<BranchPrMap> {
  // No provider / unconfigured auth → no reviews. Not an error: bare
  // repos are first-class, mirroring the TUI's usePrData.
  const provider = resolveProvider();
  if (!provider) return {};
  return provider.fetchPullRequests();
}

/** The identifier the provider uses for the authenticated user in
 *  reviewer lists — GitHub's login, ADO's email (each provider's
 *  `matchesUser` compares exactly this). Lets the renderer patch the
 *  viewer's reviewer entry optimistically after a verdict. */
export function getReviewViewer(): { identifier: string } | null {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const identifier =
    config.vendor === 'github' ? config.vendorProject?.username : config.email;
  return identifier ? { identifier } : null;
}

export async function fetchCommentThreads(
  prId: number
): Promise<PullRequestComments> {
  const provider = resolveProvider();
  if (!provider) return { threads: [], generalComments: [] };
  return provider.fetchCommentThreads(prId);
}

export async function replyToThread(req: ReplyRequest): Promise<void> {
  const provider = resolveProvider();
  if (!provider) return;
  await provider.replyToThread(req);
}

export async function setThreadResolved(req: ResolveRequest): Promise<void> {
  const provider = resolveProvider();
  if (!provider) return;
  await provider.setThreadResolved(req);
}

// IPC-boundary validation: these values arrive from the (sandboxed,
// remote-content-rendering) renderer and end up interpolated into
// provider API paths — never trust them structurally.
function requirePrId(prId: unknown): number {
  if (typeof prId !== 'number' || !Number.isInteger(prId) || prId <= 0) {
    throw new Error('Invalid PR id');
  }
  return prId;
}

const VERDICTS: readonly ReviewVerdict[] = [
  'approve',
  'approve-with-suggestions',
  'wait-for-author',
  'reject',
];

export async function fetchPrDescription(prId: number): Promise<string> {
  const id = requirePrId(prId);
  const provider = resolveProvider();
  if (!provider) return '';
  return provider.fetchPrDescription(id);
}

export async function submitReviewVerdict(
  prId: number,
  verdict: ReviewVerdict
): Promise<void> {
  const id = requirePrId(prId);
  if (!VERDICTS.includes(verdict)) {
    throw new Error(`Invalid review verdict: ${String(verdict)}`);
  }
  const provider = resolveProvider();
  if (!provider) throw new Error('No review provider is configured');
  await provider.submitReviewVerdict(id, verdict);
}

// ── Diff (git-side, no provider needed) ──────────────────────────

export function getDiffText(sourceBranch: string, targetBranch: string) {
  requireRepo();
  return fetchDiffText(sourceBranch, targetBranch);
}

export function getFileDiffText(
  sourceBranch: string,
  targetBranch: string,
  file: string
) {
  requireRepo();
  return fetchFileDiffText(sourceBranch, targetBranch, file);
}
