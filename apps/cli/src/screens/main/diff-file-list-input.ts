import type { ActionId, KeyPress } from '@kirby/core';
import {
  planItemKey,
  snapshotRemote,
  itemBounds,
  scrollIntoView,
  stepNext,
  stepPrev,
} from '@kirby/core';
import type { RemoteCommentThread } from '@kirby/vcs-core';
import { getDisplayFiles } from '@kirby/diff';
import { handleReplyModeInput } from '../../utils/reply-mode.js';
import { handlePlanAnnotateInput } from '../../utils/plan-annotate-mode.js';
import type { DiffFileListHandlerCtx } from './input-types.js';

type Ctx = DiffFileListHandlerCtx;

/** The pane's slice of the action catalog. Typing the dispatch table
 *  against it (and not `Partial<…>`) makes an unhandled action a
 *  compile error rather than a silently dead keybinding. */
type DiffFileListAction = Extract<ActionId, `diff-file-list.${string}`>;

/** Where the cursor sits in the unified list, derived once per key. */
interface Selection {
  /** Comment cards rendered after the file rows. */
  commentCount: number;
  /** Index into `shownGeneralComments`; -1 when a file row is selected. */
  commentIdx: number;
}

type ActionHandler = (ctx: Ctx, sel: Selection) => void;

// ── Shared list mechanics ────────────────────────────────────────

/** Select unified-list item `ordinal` and scroll it into view. */
function selectItem(ctx: Ctx, ordinal: number): void {
  ctx.pane.setDiffFileIndex(ordinal);
  const bounds = itemBounds(ctx.listSpans)[ordinal];
  if (bounds) {
    ctx.pane.setDiffListScrollRow((o) =>
      scrollIntoView(o, bounds, ctx.listViewportRows)
    );
  }
}

/**
 * j/k — web-like viewport semantics over the unified list. Files and
 * comment cards are one scrollable stream. An item taller than the
 * viewport (a long comment) consumes keypresses to scroll its
 * remaining rows into view before selection moves past it, so every
 * row is reachable with j/k.
 */
function step(ctx: Ctx, walk: typeof stepNext): void {
  const r = walk({
    spans: ctx.listSpans,
    index: ctx.pane.diffFileIndex,
    offset: ctx.pane.diffListScrollRow,
    viewportRows: ctx.listViewportRows,
  });
  if (!r.moved) return;
  ctx.pane.setDiffListScrollRow(r.offset);
  if (r.index !== ctx.pane.diffFileIndex) {
    ctx.pane.setDiffFileIndex(r.index);
  }
}

/** The footer thread under the cursor, or null on a file row. */
function selectedThread(ctx: Ctx, sel: Selection): RemoteCommentThread | null {
  if (sel.commentIdx < 0) return null;
  return ctx.shownGeneralComments[sel.commentIdx] ?? null;
}

/** Plan actions need both a thread and a resolved PR to key it by. */
function planTarget(
  ctx: Ctx,
  sel: Selection
): { prId: number; thread: RemoteCommentThread } | null {
  if (ctx.prId == null) return null;
  const thread = selectedThread(ctx, sel);
  return thread ? { prId: ctx.prId, thread } : null;
}

/** Enter reply mode on `thread`, in place, with an empty buffer. */
function beginReply(ctx: Ctx, thread: RemoteCommentThread): void {
  ctx.pane.setReplyingToThreadId(thread.id);
  ctx.pane.setReplyBuffer('');
}

// ── Per-action handlers ──────────────────────────────────────────

function back(ctx: Ctx): void {
  ctx.pane.setPaneMode('pr-detail');
}

function toggleSkipped(ctx: Ctx): void {
  ctx.pane.setShowSkipped((v) => !v);
  ctx.pane.setDiffFileIndex(0);
  ctx.pane.setDiffListScrollRow(0);
}

// Comment-nav semantics mirror the diff viewer's merged nav pool:
// cycle through shownGeneralComments, wrapping at both ends, staying
// off the file rows so j/k still walks files. A single file takes one
// slot (we don't sort by line here because general comments aren't
// line-anchored).
function nextComment(ctx: Ctx, sel: Selection): void {
  if (sel.commentCount === 0) return;
  const next = sel.commentIdx < 0 ? 0 : (sel.commentIdx + 1) % sel.commentCount;
  selectItem(ctx, ctx.fileCount + next);
}

function prevComment(ctx: Ctx, sel: Selection): void {
  if (sel.commentCount === 0) return;
  const next =
    sel.commentIdx < 0
      ? sel.commentCount - 1
      : (sel.commentIdx - 1 + sel.commentCount) % sel.commentCount;
  selectItem(ctx, ctx.fileCount + next);
}

// Two sections live in this pane: files and general comments. Ctrl+↓
// from files jumps to the first comment; from comments it lands on the
// last comment (stays within the current section). Ctrl+↑ always lands
// on the first file. With no comments at all, both are no-ops since
// there's only one section to live in.
function nextSection(ctx: Ctx, sel: Selection): void {
  if (sel.commentCount === 0) return;
  const firstComment = ctx.fileCount;
  const lastComment = ctx.diffDisplayCount - 1;
  selectItem(
    ctx,
    ctx.pane.diffFileIndex < ctx.fileCount ? firstComment : lastComment
  );
}

function prevSection(ctx: Ctx, sel: Selection): void {
  if (sel.commentCount === 0) return;
  selectItem(ctx, 0);
}

function replyToThread(ctx: Ctx, sel: Selection): void {
  const thread = selectedThread(ctx, sel);
  if (!thread) return;
  beginReply(ctx, thread);
}

function toggleThreadResolved(ctx: Ctx, sel: Selection): void {
  const thread = selectedThread(ctx, sel);
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
}

// ── Plan ("add-to-cart") actions on the selected comment ─────────

function planToggle(ctx: Ctx, sel: Selection): void {
  const target = planTarget(ctx, sel);
  if (!target) return;
  const added = ctx.plan.toggle(target.prId, snapshotRemote(target.thread));
  ctx.sessions.flashStatus(added ? 'Added to plan' : 'Removed from plan');
}

function planAnnotate(ctx: Ctx, sel: Selection): void {
  const target = planTarget(ctx, sel);
  if (!target) return;
  const item = snapshotRemote(target.thread);
  const key = planItemKey(item.kind, item.id);
  const existing = ctx.plan
    .list(target.prId)
    .find((i) => planItemKey(i.kind, i.id) === key)?.annotation;
  ctx.plan.add(target.prId, item);
  ctx.pane.setAnnotatingPlanKey(key);
  ctx.pane.setAnnotationBuffer(existing ?? '');
}

function planCheckout(ctx: Ctx): void {
  if (ctx.prId == null || ctx.plan.count(ctx.prId) === 0) {
    ctx.sessions.flashStatus('Plan is empty');
    return;
  }
  ctx.pane.setPriorPaneMode('diff');
  ctx.pane.setPlanCheckoutIndex(0);
  ctx.pane.setPlanCheckoutTarget(null);
  ctx.pane.setPaneMode('plan-checkout');
}

function open(ctx: Ctx, sel: Selection): void {
  if (ctx.diffDisplayCount <= 0) return;
  if (sel.commentIdx >= 0) {
    // Enter on a comment is the same affordance as `r` — enter reply
    // mode in place, matching the diff viewer's r/Enter convergence.
    const thread = selectedThread(ctx, sel);
    if (thread) beginReply(ctx, thread);
    return;
  }
  const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.pane.showSkipped);
  const file = displayFiles[ctx.pane.diffFileIndex];
  if (!file) return;
  ctx.pane.setDiffViewFile(file.filename);
  ctx.pane.setDiffScrollOffset(0);
  ctx.pane.setPaneMode('diff-file');
}

// ── Dispatch ─────────────────────────────────────────────────────

const ACTION_HANDLERS: Record<DiffFileListAction, ActionHandler> = {
  'diff-file-list.back': back,
  'diff-file-list.toggle-skipped': toggleSkipped,
  'diff-file-list.navigate-down': (ctx) => step(ctx, stepNext),
  'diff-file-list.navigate-up': (ctx) => step(ctx, stepPrev),
  'diff-file-list.next-comment': nextComment,
  'diff-file-list.prev-comment': prevComment,
  'diff-file-list.next-section': nextSection,
  'diff-file-list.prev-section': prevSection,
  'diff-file-list.reply-to-thread': replyToThread,
  'diff-file-list.toggle-thread-resolved': toggleThreadResolved,
  'diff-file-list.plan-toggle': planToggle,
  'diff-file-list.plan-annotate': planAnnotate,
  'diff-file-list.plan-checkout': planCheckout,
  'diff-file-list.open': open,
};

function handlerFor(action: string | null): ActionHandler | undefined {
  if (action == null) return undefined;
  return ACTION_HANDLERS[action as DiffFileListAction];
}

/** Selection breakdown: indices [0, fileCount) select a file, indices
 *  at or past it select a footer comment. */
function currentSelection(ctx: Ctx): Selection {
  return {
    commentCount: ctx.shownGeneralComments.length,
    commentIdx:
      ctx.pane.diffFileIndex >= ctx.fileCount
        ? ctx.pane.diffFileIndex - ctx.fileCount
        : -1,
  };
}

export function handleDiffFileListInput(
  input: string,
  key: KeyPress,
  ctx: Ctx
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

  const handler = handlerFor(
    ctx.keybinds.resolve(input, key, 'diff-file-list')
  );
  if (handler) handler(ctx, currentSelection(ctx));
}
