import { handleTextInput, type KeyPress, type ActionId } from '@kirby/app-core';
import { handleReplyModeInput } from '../../utils/reply-mode.js';
import { updateComment, removeComment } from '@kirby/review-comments';
import { handlePlanAnnotateInput } from '../../utils/plan-annotate-mode.js';
import type { DiffViewerHandlerCtx } from './input-types.js';
import { DIFF_VIEWER_ACTIONS } from './diff-viewer-actions.js';

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
