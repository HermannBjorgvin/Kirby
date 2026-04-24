import type { Key } from 'ink';
import { getDisplayFiles } from '@kirby/diff';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { DiffFileListHandlerCtx } from './input-types.js';

// Comment-nav semantics mirror the diff viewer's merged nav pool: cycle
// through shownGeneralComments, wrapping at both ends. A single file
// still takes one slot (we don't sort by line here because general
// comments aren't line-anchored).

function clampToFirstComment(ctx: DiffFileListHandlerCtx): void {
  ctx.pane.setDiffFileIndex(ctx.fileCount);
}

function clampToLastComment(ctx: DiffFileListHandlerCtx): void {
  ctx.pane.setDiffFileIndex(ctx.diffDisplayCount - 1);
}

export function handleDiffFileListInput(
  input: string,
  key: Key,
  ctx: DiffFileListHandlerCtx
): void {
  // ── Reply mode (exempt from keybind resolution) ─────────────────
  //
  // Mirrors diff-viewer-input.ts so typing `r`, `v`, Shift+arrows etc.
  // inside a reply doesn't trigger the equivalent file-list action.
  if (ctx.pane.replyingToThreadId) {
    if (key.escape) {
      ctx.pane.setReplyingToThreadId(null);
      ctx.pane.setReplyBuffer('');
      return;
    }
    if (key.return) {
      const threadId = ctx.pane.replyingToThreadId;
      const body = ctx.pane.replyBuffer.trim();
      if (body) {
        ctx.sessions.flashStatus('Posting reply...');
        ctx.remoteCtx
          .replyToThread(threadId, body)
          .then(() => {
            ctx.pane.setReplyingToThreadId(null);
            ctx.pane.setReplyBuffer('');
            ctx.sessions.flashStatus('Reply posted');
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            ctx.sessions.flashStatus(`Reply failed: ${msg}`);
          });
      }
      return;
    }
    handleTextInput(input, key, ctx.pane.setReplyBuffer);
    return;
  }

  const action = ctx.keybinds.resolve(input, key, 'diff-file-list');

  if (action === 'diff-file-list.back') {
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  if (action === 'diff-file-list.toggle-skipped') {
    ctx.pane.setShowSkipped((v) => !v);
    ctx.pane.setDiffFileIndex(0);
    return;
  }

  if (action === 'diff-file-list.navigate-down') {
    ctx.pane.setDiffFileIndex((i) => Math.min(i + 1, ctx.diffDisplayCount - 1));
    return;
  }
  if (action === 'diff-file-list.navigate-up') {
    ctx.pane.setDiffFileIndex((i) => Math.max(i - 1, 0));
    return;
  }

  const commentCount = ctx.shownGeneralComments.length;
  const selectedCommentIdx =
    ctx.pane.diffFileIndex >= ctx.fileCount
      ? ctx.pane.diffFileIndex - ctx.fileCount
      : -1;

  // ── Comment navigation (Shift+↑/↓ or c/C) ───────────────────────
  if (action === 'diff-file-list.next-comment' && commentCount > 0) {
    // Wrap within the comment range only — stays off the file rows so
    // j/k still walks files and Shift+arrow walks comments.
    const next =
      selectedCommentIdx < 0 ? 0 : (selectedCommentIdx + 1) % commentCount;
    ctx.pane.setDiffFileIndex(ctx.fileCount + next);
    return;
  }
  if (action === 'diff-file-list.prev-comment' && commentCount > 0) {
    const next =
      selectedCommentIdx < 0
        ? commentCount - 1
        : (selectedCommentIdx - 1 + commentCount) % commentCount;
    ctx.pane.setDiffFileIndex(ctx.fileCount + next);
    return;
  }

  // ── Section jump (Ctrl+↑/↓) ─────────────────────────────────────
  if (action === 'diff-file-list.next-section') {
    if (ctx.pane.diffFileIndex < ctx.fileCount && commentCount > 0) {
      clampToFirstComment(ctx);
    } else {
      // already in comments — jump to last comment (stays within the
      // current section; mirrors diff-viewer "next-section" landing on
      // the section start but we only have one comment section here)
      clampToLastComment(ctx);
    }
    return;
  }
  if (action === 'diff-file-list.prev-section') {
    if (ctx.pane.diffFileIndex >= ctx.fileCount) {
      ctx.pane.setDiffFileIndex(0);
    } else {
      ctx.pane.setDiffFileIndex(0);
    }
    return;
  }

  // ── Reply / resolve on the selected comment ─────────────────────
  if (action === 'diff-file-list.reply-to-thread') {
    if (selectedCommentIdx < 0) return;
    const thread = ctx.shownGeneralComments[selectedCommentIdx];
    if (!thread) return;
    ctx.pane.setReplyingToThreadId(thread.id);
    ctx.pane.setReplyBuffer('');
    return;
  }
  if (action === 'diff-file-list.toggle-thread-resolved') {
    if (selectedCommentIdx < 0) return;
    const thread = ctx.shownGeneralComments[selectedCommentIdx];
    if (!thread) return;
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
    return;
  }

  if (action === 'diff-file-list.open' && ctx.diffDisplayCount > 0) {
    // Enter on a comment is the same affordance as `r` — enter reply
    // mode in place, matching the diff viewer's r/Enter convergence.
    if (selectedCommentIdx >= 0) {
      const thread = ctx.shownGeneralComments[selectedCommentIdx];
      if (thread) {
        ctx.pane.setReplyingToThreadId(thread.id);
        ctx.pane.setReplyBuffer('');
      }
      return;
    }
    const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.pane.showSkipped);
    const file = displayFiles[ctx.pane.diffFileIndex];
    if (file) {
      ctx.pane.setDiffViewFile(file.filename);
      ctx.pane.setDiffScrollOffset(0);
      ctx.pane.setPaneMode('diff-file');
      ctx.loadDiffText();
    }
    return;
  }
}
