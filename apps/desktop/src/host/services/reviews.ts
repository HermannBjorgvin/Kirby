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
function activeProvider(): ActiveProvider {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const provider = PROVIDERS.find((p) => p.id === config.vendor) ?? null;
  if (!provider) {
    throw new Error(
      'No VCS provider configured — set vendor in project or global config'
    );
  }
  if (!provider.isConfigured(config.vendorAuth, config.vendorProject)) {
    throw new Error(`VCS provider "${provider.id}" is not fully configured`);
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

export function fetchPullRequests(): Promise<BranchPrMap> {
  return activeProvider().fetchPullRequests();
}

export function fetchCommentThreads(
  prId: number
): Promise<PullRequestComments> {
  return activeProvider().fetchCommentThreads(prId);
}

export function replyToThread(req: ReplyRequest): Promise<void> {
  return activeProvider().replyToThread(req);
}

export function setThreadResolved(req: ResolveRequest): Promise<void> {
  return activeProvider().setThreadResolved(req);
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
