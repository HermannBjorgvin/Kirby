import { readConfig } from '@kirby/vcs-core';
import {
  postReviewComments,
  readComments,
  removeComment,
  updateComment,
  type PostContext,
  type ReviewComment,
} from '@kirby/review-comments';
import { requireRepo } from './repo.js';
import type { PostDraftsRequest } from '../contract.js';

/**
 * Draft review comments written by the review agent through
 * `kirby util add-comment` (stored per PR under ~/.kirby/reviews). The
 * desktop shows them live in the diff and posts them with the same
 * poster the TUI uses, so both shells stay interchangeable.
 */

export function listDraftComments(prId: number): ReviewComment[] {
  return readComments(prId);
}

export function updateDraftComment(
  prId: number,
  id: string,
  patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
): void {
  if (!updateComment(prId, id, patch)) {
    throw new Error('Draft comment no longer exists');
  }
}

export function deleteDraftComment(prId: number, id: string): void {
  if (!removeComment(prId, id)) {
    throw new Error('Draft comment no longer exists');
  }
}

/**
 * Post the given drafts (or every draft when `ids` is omitted). Marks
 * them `posting` while in flight, `posted` on success (done by the
 * poster), and back to `draft` on failure so nothing is lost.
 */
export async function postDraftComments(
  req: PostDraftsRequest
): Promise<number> {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  const vendor = config.vendor;
  if (vendor !== 'github' && vendor !== 'azure-devops') {
    throw new Error(
      vendor ? `Unsupported vendor: ${vendor}` : 'No VCS provider configured'
    );
  }
  if (vendor === 'github' && !req.headSha) {
    throw new Error('Missing head SHA — refresh pull requests and try again');
  }
  const all = readComments(req.prId);
  const wanted = all.filter(
    (c) => c.status === 'draft' && (!req.ids || req.ids.includes(c.id))
  );
  if (wanted.length === 0) return 0;

  const ctx: PostContext = {
    vendor,
    vendorAuth: config.vendorAuth,
    vendorProject: config.vendorProject,
    prId: req.prId,
    headSha: req.headSha,
  };
  for (const c of wanted) updateComment(req.prId, c.id, { status: 'posting' });
  try {
    await postReviewComments(wanted, ctx, req.event ?? 'COMMENT');
  } catch (err) {
    for (const c of wanted) updateComment(req.prId, c.id, { status: 'draft' });
    throw err;
  }
  return wanted.length;
}
