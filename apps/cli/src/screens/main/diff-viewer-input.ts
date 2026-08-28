import type { ActionId, ReviewComment, PlanItem } from '@kirby/app-core';
import {
  handleTextInput,
  type KeyPress,
  planItemKey,
  snapshotLocal,
  snapshotRemote,
} from '@kirby/app-core';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { handleReplyModeInput } from '../../utils/reply-mode.js';
import { openCommentInEditor } from '../../utils/editor-edit.js';
import {
  readComments,
  removeComment,
  updateComment,
  postReviewComments,
  type PostContext,
  type CommentPositionInfo,
} from '@kirby/review-comments';
import { getDisplayFiles } from '@kirby/diff';
import { handlePlanAnnotateInput } from '../../utils/plan-annotate-mode.js';
import type { DiffViewerHandlerCtx } from './input-types.js';

// ── Helpers ──────────────────────────────────────────────────────

function findAdjacentCommentId(
  direction: 'next' | 'prev',
  currentId: string | null,
  candidates: ReviewComment[],
  positions: Map<string, CommentPositionInfo> | undefined,
  filter?: (c: ReviewComment) => boolean
): string | undefined {
  const pool = filter ? candidates.filter(filter) : candidates;
  if (pool.length === 0) return undefined;

  if (positions && positions.size > 0) {
    const currentInfo = currentId ? positions.get(currentId) : undefined;
    const currentHeader =
      direction === 'next'
        ? currentInfo?.headerLine ?? -1
        : currentInfo?.headerLine ?? Infinity;

    const sorted = pool
      .map((c) => ({
        id: c.id,
        pos:
          positions.get(c.id)?.headerLine ??
          (direction === 'next' ? Infinity : -1),
      }))
      .sort((a, b) => (direction === 'next' ? a.pos - b.pos : b.pos - a.pos));

    const found =
      direction === 'next'
        ? sorted.find((c) => c.pos > currentHeader && c.id !== currentId)
        : sorted.find((c) => c.pos < currentHeader && c.id !== currentId);

    return (found ?? sorted[0])?.id;
  }

  const currentIdx = currentId
    ? pool.findIndex((c) => c.id === currentId)
    : direction === 'next'
    ? -1
    : 0;
  const nextIdx =
    direction === 'next'
      ? (currentIdx + 1) % pool.length
      : currentIdx <= 0
      ? pool.length - 1
      : currentIdx - 1;
  return pool[nextIdx]?.id;
}

function scrollToComment(
  commentId: string,
  ctx: DiffViewerHandlerCtx,
  maxScroll: number
) {
  const positions = ctx.commentCtx?.positions;
  if (!positions) return;
  const info = positions.get(commentId);
  if (!info) return;
  // info.refStartLine is a slot index — translate to a physical row
  // via the row map before scrolling. Pin two rows above for code
  // context.
  const rowEntry = ctx.rowMap.positions[info.refStartLine];
  if (!rowEntry) return;
  const scrollTarget = Math.max(0, rowEntry.rowStart - 2);
  ctx.pane.setDiffScrollOffset(Math.min(scrollTarget, maxScroll));
}

// ── Modes exempt from keybind resolution ─────────────────────────
// These sit *above* action dispatch: while one is active the keypress
// is text (or a y/n answer), never a bound action.

/** Inline comment editing — Esc commits, Ctrl+C discards. */
function handleInlineEditMode(
  input: string,
  key: KeyPress,
  ctx: DiffViewerHandlerCtx,
  editingCommentId: string
): void {
  if (key.escape) {
    if (ctx.commentCtx) {
      updateComment(ctx.commentCtx.prId, editingCommentId, {
        body: ctx.pane.editBuffer,
      });
    }
    ctx.pane.setEditingCommentId(null);
    ctx.pane.setEditBuffer('');
    return;
  }
  if (input === 'c' && key.ctrl) {
    ctx.pane.setEditingCommentId(null);
    ctx.pane.setEditBuffer('');
    return;
  }
  if (key.return) {
    ctx.pane.setEditBuffer((b) => b + '\n');
    return;
  }
  handleTextInput(input, key, ctx.pane.setEditBuffer);
}

/** Delete confirmation — y deletes, n/Esc cancels, anything else waits. */
function handleDeleteConfirmMode(
  input: string,
  key: KeyPress,
  ctx: DiffViewerHandlerCtx,
  pendingDeleteCommentId: string
): void {
  if (input === 'y' && ctx.commentCtx) {
    removeComment(ctx.commentCtx.prId, pendingDeleteCommentId);
    ctx.pane.setPendingDeleteCommentId(null);
    ctx.pane.setSelectedCommentId(null);
    return;
  }
  if (input === 'n' || key.escape) {
    ctx.pane.setPendingDeleteCommentId(null);
  }
}

// ── Action context ───────────────────────────────────────────────

/** Values every action handler shares, computed once per keypress. */
interface DiffViewerActionCtx {
  ctx: DiffViewerHandlerCtx;
  viewportHeight: number;
  maxScroll: number;
  /** Local drafts on the open file. Posted ones are excluded: they
   *  render via the remote-thread path (see interleaveComments), so
   *  keyboard navigation must not land on an invisible local entry. */
  fileComments: ReviewComment[];
}

type DiffViewerAction = (a: DiffViewerActionCtx) => void;

interface CommentNavEntry {
  id: string;
  lineStart: number;
  kind: 'local' | 'remote';
}

/** Local drafts and remote threads in one line-sorted pool. Walking
 *  them separately lets a single draft gate off remote threads
 *  entirely, making those threads unreachable. */
function commentNavPool({
  ctx,
  fileComments,
}: DiffViewerActionCtx): CommentNavEntry[] {
  return [
    ...fileComments.map((c) => ({
      id: c.id,
      lineStart: c.lineStart ?? Number.POSITIVE_INFINITY,
      kind: 'local' as const,
    })),
    ...(ctx.remoteCtx?.threads ?? []).map((t) => ({
      id: t.id,
      lineStart: t.lineStart ?? Number.POSITIVE_INFINITY,
      kind: 'remote' as const,
    })),
  ].sort((a, b) => a.lineStart - b.lineStart);
}

/** The selection, when it refers to a local draft. Comment actions
 *  guard on this: pressing 'x' on a remote thread would otherwise
 *  enter an invisible delete-confirm trap (renderRemoteThread draws no
 *  y/n prompt). */
function selectedLocalComment({
  ctx,
  fileComments,
}: DiffViewerActionCtx): ReviewComment | undefined {
  return ctx.pane.selectedCommentId
    ? fileComments.find((c) => c.id === ctx.pane.selectedCommentId)
    : undefined;
}

/** The selection, when it refers to a remote thread. */
function selectedRemoteThread({
  ctx,
}: DiffViewerActionCtx): RemoteCommentThread | undefined {
  return ctx.remoteCtx?.threads.find(
    (t) => t.id === ctx.pane.selectedCommentId
  );
}

/** The selection as a plan snapshot — local draft or remote thread.
 *  Both feed the same per-PR plan. */
function selectedPlanTarget(a: DiffViewerActionCtx): PlanItem | null {
  const local = selectedLocalComment(a);
  if (local) return snapshotLocal(local);
  const remote = selectedRemoteThread(a);
  return remote ? snapshotRemote(remote) : null;
}

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
  ctx.asyncOps.run('post-comment', async () => {
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

const DIFF_VIEWER_ACTIONS: Partial<Record<ActionId, DiffViewerAction>> = {
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

// ── Main entry point ─────────────────────────────────────────────

export function handleDiffViewerInput(
  input: string,
  key: KeyPress,
  ctx: DiffViewerHandlerCtx
): void {
  const viewportHeight = Math.max(1, ctx.terminal.paneRows - 3);
  // diffTotalRows is the row-count total now — `scrollOffset` is a
  // physical row offset, not a slot index.
  const maxScroll = Math.max(0, ctx.diffTotalRows - viewportHeight);
  // Posted local comments are rendered via the remote-thread path
  // (see interleaveComments) to avoid double-rendering. Skip them
  // here too so keyboard navigation (c/prev/next, v, r, p) doesn't
  // land on an invisible local entry.
  const fileComments = (ctx.commentCtx?.comments ?? []).filter(
    (c) => c.file === ctx.pane.diffViewFile && c.status !== 'posted'
  );

  // Reply mode bypass (Esc/Enter/text) — see apps/cli/src/utils/reply-mode.ts
  if (
    ctx.remoteCtx &&
    handleReplyModeInput(input, key, {
      pane: ctx.pane,
      flashStatus: ctx.sessions.flashStatus,
      replyToThread: ctx.remoteCtx.replyToThread,
      // After the post resolves, mark the thread for scroll-into-view.
      // Container's effect runs once the row map reflects the appended
      // reply, then clears this id (see DiffFileViewerContainer).
      onReplyPosted: (threadId) => {
        ctx.pane.setPendingScrollThreadId(threadId);
      },
    })
  ) {
    return;
  }

  if (ctx.pane.editingCommentId) {
    handleInlineEditMode(input, key, ctx, ctx.pane.editingCommentId);
    return;
  }

  if (ctx.pane.pendingDeleteCommentId) {
    handleDeleteConfirmMode(input, key, ctx, ctx.pane.pendingDeleteCommentId);
    return;
  }

  if (
    handlePlanAnnotateInput(input, key, {
      pane: ctx.pane,
      plan: ctx.plan,
      prId: ctx.commentCtx?.prId,
    })
  ) {
    return;
  }

  // ── Normal navigation (uses keybind resolution) ──
  const action = ctx.keybinds.resolve(input, key, 'diff-viewer');
  // `resolve` is typed as returning a plain string; an unbound key
  // (null) or an id with no entry simply misses the table.
  const handler = DIFF_VIEWER_ACTIONS[action as ActionId];
  if (!handler) return;

  handler({ ctx, viewportHeight, maxScroll, fileComments });
}
