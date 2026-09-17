import { readConfig } from '@n10/vcs-core';
import {
  postReviewComments,
  readComments,
  removeComment,
  resolveComment,
  updateComment,
  type PostContext,
  type ReviewComment,
} from '@n10/review-comments';
import { requireRepo } from './repo.js';
import type { PostDraftsRequest } from '../contract.js';

/**
 * Draft review comments written by the review agent through
 * `n10 util add-comment` (stored per PR under ~/.n10/reviews). The
 * desktop shows them live in the diff and posts them with the same
 * poster the TUI uses, so both shells stay interchangeable.
 */

/** IPC-boundary validation, matching reviews.ts. `prId` becomes a path
 *  segment under ~/.n10/reviews, so a non-integer value ('../..')
 *  would write outside the reviews directory entirely. */
function requirePrId(prId: unknown): number {
  if (typeof prId !== 'number' || !Number.isInteger(prId) || prId <= 0) {
    throw new Error('Invalid PR id');
  }
  return prId;
}

export function listDraftComments(prId: number): ReviewComment[] {
  return readComments(requirePrId(prId));
}

/** TUI parity: posted comments are immutable and a comment mid-post
 *  can't be edited or deleted out from under the poster. */
function requireEditable(prId: number, id: string): void {
  const existing = readComments(requirePrId(prId)).find((c) => c.id === id);
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
  requireEditable(requirePrId(prId), id);
  if (!updateComment(prId, id, resolvedPatch(prId, id, patch))) {
    throw new Error('Draft comment no longer exists');
  }
}

/**
 * Settle an edit's body against its severity before it is stored.
 *
 * A body that opens with a Conventional Comments header states a
 * severity too, so an edit can make the two disagree — and everything
 * downstream reads the stored one: the walkthrough's order, the rail
 * dot, the TUI's chip. `resolveComment` picks the louder, the same way
 * `n10 util add-comment` does when the agent writes the draft, so the
 * two write paths cannot leave the file in different shapes.
 */
function resolvedPatch(
  prId: number,
  id: string,
  patch: Partial<Pick<ReviewComment, 'body' | 'severity'>>
): Partial<Pick<ReviewComment, 'body' | 'severity'>> {
  if (patch.body === undefined) return patch;
  const existing = readComments(prId).find((c) => c.id === id);
  const declared = patch.severity ?? existing?.severity;
  if (!declared) return patch;
  return {
    ...patch,
    severity: resolveComment(patch.body, declared).severity,
  };
}

export function deleteDraftComment(prId: number, id: string): void {
  requireEditable(requirePrId(prId), id);
  if (!removeComment(prId, id)) {
    throw new Error('Draft comment no longer exists');
  }
}

/**
 * The provider to post through, or the reason we cannot. GitHub needs
 * a head SHA to anchor a review to, and refuses the whole batch
 * without one rather than posting some comments against the wrong
 * commit.
 */
function requirePostVendor(
  vendor: string | undefined,
  headSha: string | undefined
): 'github' | 'azure-devops' {
  if (vendor !== 'github' && vendor !== 'azure-devops') {
    throw new Error(
      vendor ? `Unsupported vendor: ${vendor}` : 'No VCS provider configured'
    );
  }
  if (vendor === 'github' && !headSha) {
    throw new Error('Missing head SHA — refresh pull requests and try again');
  }
  return vendor;
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
  requirePrId(req.prId);
  const config = readConfig(cwd);
  const vendor = requirePostVendor(config.vendor, req.headSha);
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
  // failure to exactly the comment that failed. Every draft posts as a
  // plain COMMENT — riding a verdict on whichever comment a draft
  // happens to be would let a single post make two writes (a whole-file
  // comment plus a bare verdict review on GitHub), which breaks that
  // same one-write-per-call bound. The verdict is filed separately,
  // once, after every draft is live.
  let posted = 0;
  for (const c of wanted) {
    updateComment(req.prId, c.id, { status: 'posting' });
    try {
      await postReviewComments([c], ctx, 'COMMENT');
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
  if (req.event === 'APPROVE' || req.event === 'REQUEST_CHANGES') {
    // An empty comment batch with a verdict files exactly one bare
    // review — see postGitHub's `takeVerdict` fallback.
    await postReviewComments([], ctx, req.event);
  }
  return posted;
}
