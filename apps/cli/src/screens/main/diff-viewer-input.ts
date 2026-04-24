import { spawn } from 'node:child_process';
import type { Key } from 'ink';
import type { ReviewComment } from '../../types.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import {
  readComments,
  removeComment,
  updateComment,
  postReviewComments,
  type PostContext,
  type CommentPositionInfo,
} from '@kirby/review-comments';
import { getDisplayFiles } from '@kirby/diff';
import { writeFileSync, readFileSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const scrollTarget = Math.max(0, info.refStartLine - 2);
  ctx.pane.setDiffScrollOffset(Math.min(scrollTarget, maxScroll));
}

// ── Main entry point ─────────────────────────────────────────────

export function handleDiffViewerInput(
  input: string,
  key: Key,
  ctx: DiffViewerHandlerCtx
): void {
  const viewportHeight = Math.max(1, ctx.terminal.paneRows - 3);
  const maxScroll = Math.max(0, ctx.diffTotalLines - viewportHeight);
  // Posted local comments are rendered via the remote-thread path
  // (see interleaveComments) to avoid double-rendering. Skip them
  // here too so keyboard navigation (c/prev/next, v, r, p) doesn't
  // land on an invisible local entry.
  const fileComments = (ctx.commentCtx?.comments ?? []).filter(
    (c) => c.file === ctx.pane.diffViewFile && c.status !== 'posted'
  );

  // ── Reply mode for remote threads (exempt from keybind resolution) ──
  if (ctx.pane.replyingToThreadId) {
    if (key.escape) {
      ctx.pane.setReplyingToThreadId(null);
      ctx.pane.setReplyBuffer('');
      return;
    }
    if (key.return) {
      const threadId = ctx.pane.replyingToThreadId;
      const body = ctx.pane.replyBuffer.trim();
      if (body && ctx.remoteCtx) {
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

  // ── Inline edit mode (exempt from keybind resolution) ──
  if (ctx.pane.editingCommentId) {
    if (key.escape) {
      if (ctx.commentCtx) {
        updateComment(ctx.commentCtx.prId, ctx.pane.editingCommentId, {
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
    return;
  }

  // ── Delete confirmation mode (exempt from keybind resolution) ──
  if (ctx.pane.pendingDeleteCommentId) {
    if (input === 'y' && ctx.commentCtx) {
      removeComment(ctx.commentCtx.prId, ctx.pane.pendingDeleteCommentId);
      ctx.pane.setPendingDeleteCommentId(null);
      ctx.pane.setSelectedCommentId(null);
      return;
    }
    if (input === 'n' || key.escape) {
      ctx.pane.setPendingDeleteCommentId(null);
      return;
    }
    return;
  }

  // ── Normal navigation (uses keybind resolution) ──
  const action = ctx.keybinds.resolve(input, key, 'diff-viewer');

  if (action === 'diff-viewer.back') {
    ctx.pane.setPaneMode('diff');
    ctx.pane.setDiffViewFile(null);
    return;
  }

  // Scroll
  if (action === 'diff-viewer.scroll-down') {
    ctx.pane.setDiffScrollOffset((o) => Math.min(o + 1, maxScroll));
    return;
  }
  if (action === 'diff-viewer.scroll-up') {
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - 1, 0));
    return;
  }
  if (action === 'diff-viewer.half-page-down') {
    const half = Math.floor(viewportHeight / 2);
    ctx.pane.setDiffScrollOffset((o) => Math.min(o + half, maxScroll));
    return;
  }
  if (action === 'diff-viewer.half-page-up') {
    const half = Math.floor(viewportHeight / 2);
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - half, 0));
    return;
  }
  if (action === 'diff-viewer.go-top') {
    ctx.pane.setDiffScrollOffset(0);
    return;
  }
  if (action === 'diff-viewer.go-bottom') {
    ctx.pane.setDiffScrollOffset(maxScroll);
    return;
  }

  // Section jump — Ctrl+↑/↓. Anchors are sorted annotated-line indices
  // where a navigable section starts (diff, out-of-diff comments, etc.).
  if (action === 'diff-viewer.next-section') {
    const cur = ctx.pane.diffScrollOffset;
    const next = ctx.sectionAnchors.find((a) => a > cur);
    if (next !== undefined) {
      ctx.pane.setDiffScrollOffset(Math.min(next, maxScroll));
    }
    return;
  }
  if (action === 'diff-viewer.prev-section') {
    const cur = ctx.pane.diffScrollOffset;
    const prev = [...ctx.sectionAnchors].reverse().find((a) => a < cur);
    ctx.pane.setDiffScrollOffset(prev ?? 0);
    return;
  }

  // File navigation
  if (action === 'diff-viewer.next-file') {
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
    return;
  }
  if (action === 'diff-viewer.prev-file') {
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
    return;
  }

  // Comment navigation — walks a single pool merging local drafts and
  // remote threads, sorted by line. Without this, a single draft gates
  // off remote threads entirely (next/prev short-circuit on
  // fileComments.length > 0) and remote threads become unreachable.
  const fileRemoteThreads = ctx.remoteCtx?.threads ?? [];
  const navPool: { id: string; lineStart: number; kind: 'local' | 'remote' }[] =
    [
      ...fileComments.map((c) => ({
        id: c.id,
        lineStart: c.lineStart ?? Number.POSITIVE_INFINITY,
        kind: 'local' as const,
      })),
      ...fileRemoteThreads.map((t) => ({
        id: t.id,
        lineStart: t.lineStart ?? Number.POSITIVE_INFINITY,
        kind: 'remote' as const,
      })),
    ].sort((a, b) => a.lineStart - b.lineStart);

  if (action === 'diff-viewer.next-comment' && navPool.length > 0) {
    const currentIdx = navPool.findIndex(
      (e) => e.id === ctx.pane.selectedCommentId
    );
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % navPool.length;
    const next = navPool[nextIdx]!;
    ctx.pane.setSelectedCommentId(next.id);
    scrollToComment(next.id, ctx, maxScroll);
    return;
  }
  if (action === 'diff-viewer.prev-comment' && navPool.length > 0) {
    const currentIdx = navPool.findIndex(
      (e) => e.id === ctx.pane.selectedCommentId
    );
    const prevIdx = currentIdx <= 0 ? navPool.length - 1 : currentIdx - 1;
    const prev = navPool[prevIdx]!;
    ctx.pane.setSelectedCommentId(prev.id);
    scrollToComment(prev.id, ctx, maxScroll);
    return;
  }

  // Comment actions — only apply when the selected id refers to a local
  // draft. Without this guard, pressing 'x' while a remote thread is
  // selected enters an invisible delete-confirm trap (renderRemoteThread
  // draws no y/n prompt).
  const selectedLocal = ctx.pane.selectedCommentId
    ? fileComments.find((c) => c.id === ctx.pane.selectedCommentId)
    : undefined;

  if (
    action === 'diff-viewer.delete-comment' &&
    selectedLocal &&
    ctx.commentCtx
  ) {
    ctx.pane.setPendingDeleteCommentId(selectedLocal.id);
    return;
  }

  if (action === 'diff-viewer.edit-comment' && ctx.pane.selectedCommentId) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (comment) {
      ctx.pane.setEditingCommentId(comment.id);
      ctx.pane.setEditBuffer(comment.body);
    }
    return;
  }

  if (
    action === 'diff-viewer.post-comment' &&
    ctx.pane.selectedCommentId &&
    ctx.commentCtx
  ) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (!comment || comment.status !== 'draft') return;

    const pr = ctx.commentCtx.selectedReviewPr;
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
      prId: ctx.commentCtx.prId,
      headSha: pr.headSha,
    };

    const postedId = comment.id;
    const prId = ctx.commentCtx.prId;
    const commentCtx = ctx.commentCtx;
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
    return;
  }

  if (
    action === 'diff-viewer.editor-edit' &&
    ctx.pane.selectedCommentId &&
    ctx.commentCtx
  ) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (!comment) return;

    const editor =
      ctx.config.config.editor || process.env.VISUAL || process.env.EDITOR;
    if (!editor) {
      ctx.sessions.flashStatus('No editor configured — set one in settings');
      return;
    }

    const tmpFile = join(tmpdir(), `kirby-comment-${comment.id}.md`);
    writeFileSync(tmpFile, comment.body, 'utf8');

    spawn(editor, [tmpFile], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    const prId = ctx.commentCtx!.prId;
    const commentId = comment.id;
    const watcher = watch(tmpFile, () => {
      try {
        const newBody = readFileSync(tmpFile, 'utf8');
        if (newBody !== comment.body) {
          updateComment(prId, commentId, { body: newBody });
        }
      } catch {
        // File may be temporarily unavailable during save
      }
    });

    const timer = setTimeout(() => {
      watcher.close();
    }, 30 * 60 * 1000);
    timer.unref();

    ctx.sessions.flashStatus(`Opened comment in ${editor}`);
    return;
  }

  // ── Remote thread actions ──────────────────────────────────────
  const selectedRemoteThread = ctx.remoteCtx?.threads.find(
    (t) => t.id === ctx.pane.selectedCommentId
  );

  if (
    action === 'diff-viewer.reply-to-thread' &&
    selectedRemoteThread &&
    ctx.remoteCtx
  ) {
    ctx.pane.setReplyingToThreadId(selectedRemoteThread.id);
    ctx.pane.setReplyBuffer('');
    return;
  }

  if (
    action === 'diff-viewer.toggle-thread-resolved' &&
    selectedRemoteThread &&
    ctx.remoteCtx
  ) {
    const newResolved = !selectedRemoteThread.isResolved;
    ctx.sessions.flashStatus(
      newResolved ? 'Resolving thread...' : 'Reopening thread...'
    );
    ctx.remoteCtx
      .toggleResolved(selectedRemoteThread.id, newResolved)
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
}
