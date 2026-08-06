import type { Key } from 'ink';
import { getDisplayFiles } from '@kirby/diff';
import { handleReplyModeInput } from '../../utils/reply-mode.js';
import { handlePlanAnnotateInput } from '../../utils/plan-annotate-mode.js';
import { planItemKey, snapshotRemote } from '../../plan/plan-types.js';
import {
  itemBounds,
  scrollIntoView,
  stepNext,
  stepPrev,
} from '../../utils/virtual-viewport.js';
import type { DiffFileListHandlerCtx } from './input-types.js';

// Comment-nav semantics mirror the diff viewer's merged nav pool: cycle
// through shownGeneralComments, wrapping at both ends. A single file
// still takes one slot (we don't sort by line here because general
// comments aren't line-anchored).

/** Select unified-list item `ordinal` and scroll it into view. */
function selectItem(ctx: DiffFileListHandlerCtx, ordinal: number): void {
  ctx.pane.setDiffFileIndex(ordinal);
  const bounds = itemBounds(ctx.listSpans)[ordinal];
  if (bounds) {
    ctx.pane.setDiffListScrollRow((o) =>
      scrollIntoView(o, bounds, ctx.listViewportRows)
    );
  }
}

function clampToFirstComment(ctx: DiffFileListHandlerCtx): void {
  selectItem(ctx, ctx.fileCount);
}

function clampToLastComment(ctx: DiffFileListHandlerCtx): void {
  selectItem(ctx, ctx.diffDisplayCount - 1);
}

export function handleDiffFileListInput(
  input: string,
  key: Key,
  ctx: DiffFileListHandlerCtx
): void {
  // Reply mode bypass (Esc/Enter/text) — short-circuits keybind
  // dispatch so typing `r`, `v`, Shift+arrows etc. doesn't fire their
  // action while the user is composing a reply.
  if (
    handleReplyModeInput(input, key, {
      pane: ctx.pane,
      flashStatus: ctx.sessions.flashStatus,
      replyToThread: ctx.remoteCtx.replyToThread,
      // The posted reply grows the thread card; queue a reveal so the
      // user sees what they just sent (useDiffListScrollSync consumes
      // this once the layout reflects the new reply).
      onReplyPosted: (threadId) => ctx.pane.setPendingScrollThreadId(threadId),
    })
  ) {
    return;
  }

  // Plan annotation mode bypass — same contract as reply mode.
  if (
    handlePlanAnnotateInput(input, key, {
      pane: ctx.pane,
      plan: ctx.plan,
      prId: ctx.prId,
    })
  ) {
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
    ctx.pane.setDiffListScrollRow(0);
    return;
  }

  const commentCount = ctx.shownGeneralComments.length;
  const selectedCommentIdx =
    ctx.pane.diffFileIndex >= ctx.fileCount
      ? ctx.pane.diffFileIndex - ctx.fileCount
      : -1;

  // ── j/k — web-like viewport semantics over the unified list ─────
  // Files and comment cards are one scrollable stream. An item taller
  // than the viewport (a long comment) consumes keypresses to scroll
  // its remaining rows into view before selection moves past it
  // (stepNext/stepPrev), so every row is reachable with j/k.
  if (action === 'diff-file-list.navigate-down') {
    const r = stepNext({
      spans: ctx.listSpans,
      index: ctx.pane.diffFileIndex,
      offset: ctx.pane.diffListScrollRow,
      viewportRows: ctx.listViewportRows,
    });
    if (r.moved) {
      ctx.pane.setDiffListScrollRow(r.offset);
      if (r.index !== ctx.pane.diffFileIndex) {
        ctx.pane.setDiffFileIndex(r.index);
      }
    }
    return;
  }
  if (action === 'diff-file-list.navigate-up') {
    const r = stepPrev({
      spans: ctx.listSpans,
      index: ctx.pane.diffFileIndex,
      offset: ctx.pane.diffListScrollRow,
      viewportRows: ctx.listViewportRows,
    });
    if (r.moved) {
      ctx.pane.setDiffListScrollRow(r.offset);
      if (r.index !== ctx.pane.diffFileIndex) {
        ctx.pane.setDiffFileIndex(r.index);
      }
    }
    return;
  }

  // ── Comment navigation (Shift+↑/↓ or c/C) ───────────────────────
  if (action === 'diff-file-list.next-comment' && commentCount > 0) {
    // Wrap within the comment range only — stays off the file rows so
    // j/k still walks files and Shift+arrow walks comments.
    const next =
      selectedCommentIdx < 0 ? 0 : (selectedCommentIdx + 1) % commentCount;
    selectItem(ctx, ctx.fileCount + next);
    return;
  }
  if (action === 'diff-file-list.prev-comment' && commentCount > 0) {
    const next =
      selectedCommentIdx < 0
        ? commentCount - 1
        : (selectedCommentIdx - 1 + commentCount) % commentCount;
    selectItem(ctx, ctx.fileCount + next);
    return;
  }

  // ── Section jump (Ctrl+↑/↓) ─────────────────────────────────────
  // Two sections in this pane: files and general comments. Ctrl+↓
  // from files jumps to the first comment; from comments it lands on
  // the last comment (stays within the current section). Ctrl+↑
  // always lands on the first file. With no comments at all, both are
  // no-ops since there's only one section to live in.
  if (action === 'diff-file-list.next-section') {
    if (commentCount === 0) return;
    if (ctx.pane.diffFileIndex < ctx.fileCount) {
      clampToFirstComment(ctx);
    } else {
      clampToLastComment(ctx);
    }
    return;
  }
  if (action === 'diff-file-list.prev-section') {
    if (commentCount === 0) return;
    selectItem(ctx, 0);
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

  // ── Plan ("add-to-cart") actions on the selected comment ────────
  if (action === 'diff-file-list.plan-toggle') {
    if (selectedCommentIdx < 0 || ctx.prId == null) return;
    const thread = ctx.shownGeneralComments[selectedCommentIdx];
    if (!thread) return;
    const added = ctx.plan.toggle(ctx.prId, snapshotRemote(thread));
    ctx.sessions.flashStatus(added ? 'Added to plan' : 'Removed from plan');
    return;
  }
  if (action === 'diff-file-list.plan-annotate') {
    if (selectedCommentIdx < 0 || ctx.prId == null) return;
    const thread = ctx.shownGeneralComments[selectedCommentIdx];
    if (!thread) return;
    const item = snapshotRemote(thread);
    const key = planItemKey(item.kind, item.id);
    const existing = ctx.plan
      .list(ctx.prId)
      .find((i) => planItemKey(i.kind, i.id) === key)?.annotation;
    ctx.plan.add(ctx.prId, item);
    ctx.pane.setAnnotatingPlanKey(key);
    ctx.pane.setAnnotationBuffer(existing ?? '');
    return;
  }
  if (action === 'diff-file-list.plan-checkout') {
    if (ctx.prId == null || ctx.plan.count(ctx.prId) === 0) {
      ctx.sessions.flashStatus('Plan is empty');
      return;
    }
    ctx.pane.setPriorPaneMode('diff');
    ctx.pane.setPlanCheckoutIndex(0);
    ctx.pane.setPlanCheckoutTarget(null);
    ctx.pane.setPaneMode('plan-checkout');
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
    }
    return;
  }
}
