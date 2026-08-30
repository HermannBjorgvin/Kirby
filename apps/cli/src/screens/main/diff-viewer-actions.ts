import { type ActionId, planItemKey } from '@kirby/core';
import {
  readComments,
  updateComment,
  postReviewComments,
  type PostContext,
} from '@kirby/review-comments';
import { getDisplayFiles } from '@kirby/diff';
import { openCommentInEditor } from '../../utils/editor-edit.js';
import {
  type DiffViewerActionCtx,
  type DiffViewerAction,
  commentNavPool,
  selectedLocalComment,
  selectedRemoteThread,
  selectedPlanTarget,
  findAdjacentCommentId,
  scrollToComment,
} from './diff-viewer-action-context.js';

// ── Actions ──────────────────────────────────────────────────────

function actionBack({ ctx }: DiffViewerActionCtx): void {
  ctx.pane.setPaneMode('diff');
  ctx.pane.setDiffViewFile(null);
}

function actionScrollDown({ ctx, maxScroll }: DiffViewerActionCtx): void {
  ctx.pane.setDiffScrollOffset((o) => Math.min(o + 1, maxScroll));
}

function actionScrollUp({ ctx }: DiffViewerActionCtx): void {
  ctx.pane.setDiffScrollOffset((o) => Math.max(o - 1, 0));
}

function actionHalfPageDown({
  ctx,
  viewportHeight,
  maxScroll,
}: DiffViewerActionCtx): void {
  const half = Math.floor(viewportHeight / 2);
  ctx.pane.setDiffScrollOffset((o) => Math.min(o + half, maxScroll));
}

function actionHalfPageUp({ ctx, viewportHeight }: DiffViewerActionCtx): void {
  const half = Math.floor(viewportHeight / 2);
  ctx.pane.setDiffScrollOffset((o) => Math.max(o - half, 0));
}

function actionGoTop({ ctx }: DiffViewerActionCtx): void {
  ctx.pane.setDiffScrollOffset(0);
}

function actionGoBottom({ ctx, maxScroll }: DiffViewerActionCtx): void {
  ctx.pane.setDiffScrollOffset(maxScroll);
}

// Section jump — Ctrl+↑/↓. Anchors are sorted physical-row offsets
// where a navigable section starts (diff, out-of-diff comments, etc.).
function actionNextSection({ ctx, maxScroll }: DiffViewerActionCtx): void {
  const cur = ctx.pane.diffScrollOffset;
  const next = ctx.sectionAnchorRows.find((a) => a > cur);
  if (next !== undefined) {
    ctx.pane.setDiffScrollOffset(Math.min(next, maxScroll));
  }
}

function actionPrevSection({ ctx }: DiffViewerActionCtx): void {
  const cur = ctx.pane.diffScrollOffset;
  const prev = [...ctx.sectionAnchorRows].reverse().find((a) => a < cur);
  ctx.pane.setDiffScrollOffset(prev ?? 0);
}

function actionNextFile({ ctx }: DiffViewerActionCtx): void {
  const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.pane.showSkipped);
  const currentIdx = displayFiles.findIndex(
    (f) => f.filename === ctx.pane.diffViewFile
  );
  if (currentIdx >= 0 && currentIdx < displayFiles.length - 1) {
    const nextFile = displayFiles[currentIdx + 1]!;
    ctx.pane.setDiffViewFile(nextFile.filename);
    ctx.pane.setDiffFileIndex(currentIdx + 1);
    ctx.pane.setDiffScrollOffset(0);
  }
}

function actionPrevFile({ ctx }: DiffViewerActionCtx): void {
  const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.pane.showSkipped);
  const currentIdx = displayFiles.findIndex(
    (f) => f.filename === ctx.pane.diffViewFile
  );
  if (currentIdx > 0) {
    const prevFile = displayFiles[currentIdx - 1]!;
    ctx.pane.setDiffViewFile(prevFile.filename);
    ctx.pane.setDiffFileIndex(currentIdx - 1);
    ctx.pane.setDiffScrollOffset(0);
  }
}

function actionNextComment(a: DiffViewerActionCtx): void {
  const { ctx, maxScroll } = a;
  const navPool = commentNavPool(a);
  if (navPool.length === 0) return;
  const currentIdx = navPool.findIndex(
    (e) => e.id === ctx.pane.selectedCommentId
  );
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % navPool.length;
  const next = navPool[nextIdx]!;
  ctx.pane.setSelectedCommentId(next.id);
  scrollToComment(next.id, ctx, maxScroll);
}

function actionPrevComment(a: DiffViewerActionCtx): void {
  const { ctx, maxScroll } = a;
  const navPool = commentNavPool(a);
  if (navPool.length === 0) return;
  const currentIdx = navPool.findIndex(
    (e) => e.id === ctx.pane.selectedCommentId
  );
  const prevIdx = currentIdx <= 0 ? navPool.length - 1 : currentIdx - 1;
  const prev = navPool[prevIdx]!;
  ctx.pane.setSelectedCommentId(prev.id);
  scrollToComment(prev.id, ctx, maxScroll);
}

function actionDeleteComment(a: DiffViewerActionCtx): void {
  const selectedLocal = selectedLocalComment(a);
  if (!selectedLocal || !a.ctx.commentCtx) return;
  a.ctx.pane.setPendingDeleteCommentId(selectedLocal.id);
}

function actionEditComment(a: DiffViewerActionCtx): void {
  const { ctx, fileComments } = a;
  if (!ctx.pane.selectedCommentId) return;
  const comment = fileComments.find((c) => c.id === ctx.pane.selectedCommentId);
  if (comment) {
    ctx.pane.setEditingCommentId(comment.id);
    ctx.pane.setEditBuffer(comment.body);
  }
}

function actionPostComment(a: DiffViewerActionCtx): void {
  const { ctx, fileComments, maxScroll } = a;
  const commentCtx = ctx.commentCtx;
  if (!ctx.pane.selectedCommentId || !commentCtx) return;

  const comment = fileComments.find((c) => c.id === ctx.pane.selectedCommentId);
  if (!comment || comment.status !== 'draft') return;

  const pr = commentCtx.selectedReviewPr;
  const vendor = ctx.config.config.vendor;
  if (!vendor) {
    ctx.sessions.flashStatus('No VCS configured');
    return;
  }
  if (vendor !== 'github' && vendor !== 'azure-devops') {
    ctx.sessions.flashStatus(`Unsupported vendor: ${vendor}`);
    return;
  }
  if (vendor === 'github' && !pr.headSha) {
    ctx.sessions.flashStatus('Missing head SHA — try refreshing PR data');
    return;
  }

  const postCtx: PostContext = {
    vendor,
    vendorAuth: ctx.config.config.vendorAuth,
    vendorProject: ctx.config.config.vendorProject,
    prId: commentCtx.prId,
    headSha: pr.headSha,
  };

  const postedId = comment.id;
  const prId = commentCtx.prId;
  updateComment(prId, postedId, { status: 'posting' });

  // Loading state shown by the top-right spinner; no "Posting
  // comment…" flash. Result/failure toasts fire on completion.
  void ctx.asyncOps.run('post-comment', async () => {
    try {
      await postReviewComments([comment], postCtx);
      ctx.sessions.flashStatus('Comment posted');
      // Refetch remote threads so the newly-created remote thread
      // for this comment shows up in the diff viewer — the local
      // copy is now `status: 'posted'` and filtered from render, so
      // without this refresh there'd be a visual gap until the user
      // re-opened the PR.
      ctx.remoteCtx?.refresh();
      const freshComments = readComments(prId).filter(
        (c) => c.file === ctx.pane.diffViewFile
      );
      const nextDraftId = findAdjacentCommentId(
        'next',
        postedId,
        freshComments,
        commentCtx.positions,
        (c) => c.status === 'draft'
      );
      if (nextDraftId) {
        ctx.pane.setSelectedCommentId(nextDraftId);
        scrollToComment(nextDraftId, ctx, maxScroll);
      } else {
        ctx.pane.setSelectedCommentId(null);
      }
    } catch (err) {
      updateComment(prId, postedId, { status: 'draft' });
      ctx.sessions.flashStatus(`Post failed: ${(err as Error).message}`);
    }
  });
}

function actionEditorEdit(a: DiffViewerActionCtx): void {
  const { ctx, fileComments } = a;
  const commentCtx = ctx.commentCtx;
  if (!ctx.pane.selectedCommentId || !commentCtx) return;

  const comment = fileComments.find((c) => c.id === ctx.pane.selectedCommentId);
  if (!comment) return;

  const editor =
    ctx.config.config.editor || process.env.VISUAL || process.env.EDITOR;
  if (!editor) {
    ctx.sessions.flashStatus('No editor configured — set one in settings');
    return;
  }

  const prId = commentCtx.prId;
  openCommentInEditor({
    commentId: comment.id,
    initialBody: comment.body,
    editor,
    onUpdate: (newBody) => {
      updateComment(prId, comment.id, { body: newBody });
    },
  });

  ctx.sessions.flashStatus(`Opened comment in ${editor}`);
}

function actionReplyToThread(a: DiffViewerActionCtx): void {
  const thread = selectedRemoteThread(a);
  if (!thread || !a.ctx.remoteCtx) return;
  a.ctx.pane.setReplyingToThreadId(thread.id);
  a.ctx.pane.setReplyBuffer('');
}

function actionToggleThreadResolved(a: DiffViewerActionCtx): void {
  const { ctx } = a;
  const thread = selectedRemoteThread(a);
  if (!thread || !ctx.remoteCtx) return;

  const newResolved = !thread.isResolved;
  ctx.sessions.flashStatus(
    newResolved ? 'Resolving thread...' : 'Reopening thread...'
  );
  ctx.remoteCtx
    .toggleResolved(thread.id, newResolved)
    .then((success) => {
      if (success) {
        ctx.sessions.flashStatus(
          newResolved ? 'Thread resolved' : 'Thread reopened'
        );
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.sessions.flashStatus(`Failed: ${msg}`);
    });
}

// ── Plan ("add-to-cart") actions ─────────────────────────────────

function actionPlanToggle(a: DiffViewerActionCtx): void {
  const { ctx } = a;
  const prId = ctx.commentCtx?.prId;
  const planTarget = selectedPlanTarget(a);
  if (!planTarget || prId == null) return;
  const added = ctx.plan.toggle(prId, planTarget);
  ctx.sessions.flashStatus(added ? 'Added to plan' : 'Removed from plan');
}

function actionPlanAnnotate(a: DiffViewerActionCtx): void {
  const { ctx } = a;
  const prId = ctx.commentCtx?.prId;
  const planTarget = selectedPlanTarget(a);
  if (!planTarget || prId == null) return;
  // Add immediately (cart feedback), then open the note composer
  // pre-filled with any existing note so re-annotating never blanks it.
  const key = planItemKey(planTarget.kind, planTarget.id);
  const existing = ctx.plan
    .list(prId)
    .find((i) => planItemKey(i.kind, i.id) === key)?.annotation;
  ctx.plan.add(prId, planTarget);
  ctx.pane.setAnnotatingPlanKey(key);
  ctx.pane.setAnnotationBuffer(existing ?? '');
}

function actionPlanCheckout({ ctx }: DiffViewerActionCtx): void {
  const prId = ctx.commentCtx?.prId;
  if (prId == null || ctx.plan.count(prId) === 0) {
    ctx.sessions.flashStatus('Plan is empty');
    return;
  }
  ctx.pane.setPriorPaneMode('diff-file');
  ctx.pane.setPlanCheckoutIndex(0);
  ctx.pane.setPlanCheckoutTarget(null);
  ctx.pane.setPaneMode('plan-checkout');
}

// ── Dispatch table ───────────────────────────────────────────────
// Keyed by the ids the keybind registry resolves to, so adding an
// action is a table entry rather than another branch.

export const DIFF_VIEWER_ACTIONS: Partial<Record<ActionId, DiffViewerAction>> =
  {
    'diff-viewer.back': actionBack,
    'diff-viewer.scroll-down': actionScrollDown,
    'diff-viewer.scroll-up': actionScrollUp,
    'diff-viewer.half-page-down': actionHalfPageDown,
    'diff-viewer.half-page-up': actionHalfPageUp,
    'diff-viewer.go-top': actionGoTop,
    'diff-viewer.go-bottom': actionGoBottom,
    'diff-viewer.next-section': actionNextSection,
    'diff-viewer.prev-section': actionPrevSection,
    'diff-viewer.next-file': actionNextFile,
    'diff-viewer.prev-file': actionPrevFile,
    'diff-viewer.next-comment': actionNextComment,
    'diff-viewer.prev-comment': actionPrevComment,
    'diff-viewer.delete-comment': actionDeleteComment,
    'diff-viewer.edit-comment': actionEditComment,
    'diff-viewer.post-comment': actionPostComment,
    'diff-viewer.editor-edit': actionEditorEdit,
    'diff-viewer.reply-to-thread': actionReplyToThread,
    'diff-viewer.toggle-thread-resolved': actionToggleThreadResolved,
    'diff-viewer.plan-toggle': actionPlanToggle,
    'diff-viewer.plan-annotate': actionPlanAnnotate,
    'diff-viewer.plan-checkout': actionPlanCheckout,
  };
