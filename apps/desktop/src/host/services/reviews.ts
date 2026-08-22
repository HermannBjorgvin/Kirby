import { readConfig } from '@kirby/vcs-core';
import type { BranchPrMap, PullRequestComments } from '@kirby/vcs-core';
import { fetchDiffText, fetchFileDiffText } from '@kirby/app-core';
import { PROVIDERS, requireRepo } from './repo.js';
import type { ReplyRequest, ResolveRequest } from '../contract.js';

interface ActiveProvider {
  fetchPullRequests(): Promise<BranchPrMap>;
  fetchCommentThreads(prId: number): Promise<PullRequestComments>;
  replyToThread(req: ReplyRequest): Promise<void>;
  setThreadResolved(req: ResolveRequest): Promise<void>;
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
  };
}

export async function fetchPullRequests(): Promise<BranchPrMap> {
  // No provider / unconfigured auth → no reviews. Not an error: bare
  // repos are first-class, mirroring the TUI's usePrData.
  const provider = resolveProvider();
  if (!provider) return {};
  return provider.fetchPullRequests();
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
