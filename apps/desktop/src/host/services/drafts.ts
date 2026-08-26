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

/** TUI parity: posted comments are immutable and a comment mid-post
 *  can't be edited or deleted out from under the poster. */
function requireEditable(prId: number, id: string): void {
  const existing = readComments(prId).find((c) => c.id === id);
  if (!existing) {
    throw new Error('Draft comment no longer exists');
  }
  if (existing.status === 'posted') {
    throw new Error('Comment is already posted');
  }
  if (existing.status === 'posting') {
    throw new Error('Comment is being posted');
  }
}

export function updateDraftComment(
  prId: number,
  id: string,
  patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
): void {
  requireEditable(prId, id);
  if (!updateComment(prId, id, patch)) {
    throw new Error('Draft comment no longer exists');
  }
}

export function deleteDraftComment(prId: number, id: string): void {
  requireEditable(prId, id);
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
  // One comment per post call, like the TUI's diff viewer. A batch
  // that dies mid-way would otherwise reset already-live comments back
  // to draft (duplicating them on retry); posting singly bounds any
  // failure to exactly the comment that failed.
  let posted = 0;
  for (const c of wanted) {
    updateComment(req.prId, c.id, { status: 'posting' });
    try {
      // A non-COMMENT event (verdict) must ride exactly one review —
      // repeating it per comment would file N approvals on GitHub.
      await postReviewComments(
        [c],
        ctx,
        posted === 0 ? req.event ?? 'COMMENT' : 'COMMENT'
      );
      posted += 1;
    } catch (err) {
      updateComment(req.prId, c.id, { status: 'draft' });
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        posted > 0
          ? `Posted ${posted} of ${wanted.length}, then failed: ${message}`
          : message
      );
    }
  }
  return posted;
}
