import { spawn } from 'node:child_process';
import type { Key } from 'ink';
import type { ReviewComment } from '../../types.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import {
  readComments,
  removeComment,
  updateComment,
} from '../../utils/comment-store.js';
import {
  postReviewComments,
  type PostContext,
} from '../../utils/comment-poster.js';
import { getDisplayFiles } from '@kirby/diff';
import type { CommentPositionInfo } from '../../utils/comment-renderer.js';
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

// ── Scroll handling ──────────────────────────────────────────────

function handleDiffScroll(
  input: string,
  key: Key,
  ctx: DiffViewerHandlerCtx,
  viewportHeight: number,
  maxScroll: number
): boolean {
  if (input === 'j' || key.downArrow) {
    ctx.pane.setDiffScrollOffset((o) => Math.min(o + 1, maxScroll));
    return true;
  }
  if (input === 'k' || key.upArrow) {
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - 1, 0));
    return true;
  }
  if (input === 'd') {
    const half = Math.floor(viewportHeight / 2);
    ctx.pane.setDiffScrollOffset((o) => Math.min(o + half, maxScroll));
    return true;
  }
  if (input === 'u') {
    const half = Math.floor(viewportHeight / 2);
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - half, 0));
    return true;
  }
  if (key.pageDown) {
    ctx.pane.setDiffScrollOffset((o) =>
      Math.min(o + viewportHeight, maxScroll)
    );
    return true;
  }
  if (key.pageUp) {
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - viewportHeight, 0));
    return true;
  }
  if (input === 'g') {
    ctx.pane.setDiffScrollOffset(0);
    return true;
  }
  if (input === 'G') {
    ctx.pane.setDiffScrollOffset(maxScroll);
    return true;
  }
  return false;
}

// ── File navigation ──────────────────────────────────────────────

function handleDiffFileNav(input: string, ctx: DiffViewerHandlerCtx): boolean {
  if (input === 'n') {
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
    return true;
  }
  if (input === 'N') {
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
    return true;
  }
  return false;
}

// ── Comment navigation ───────────────────────────────────────────

function handleCommentNav(
  input: string,
  key: Key,
  ctx: DiffViewerHandlerCtx,
  fileComments: ReviewComment[],
  maxScroll: number
): boolean {
  if ((input === 'c' || key.rightArrow) && fileComments.length > 0) {
    const nextId = findAdjacentCommentId(
      'next',
      ctx.pane.selectedCommentId,
      fileComments,
      ctx.commentCtx?.positions
    );
    if (nextId) {
      ctx.pane.setSelectedCommentId(nextId);
      scrollToComment(nextId, ctx, maxScroll);
    }
    return true;
  }

  if ((input === 'C' || key.leftArrow) && fileComments.length > 0) {
    const prevId = findAdjacentCommentId(
      'prev',
      ctx.pane.selectedCommentId,
      fileComments,
      ctx.commentCtx?.positions
    );
    if (prevId) {
      ctx.pane.setSelectedCommentId(prevId);
      scrollToComment(prevId, ctx, maxScroll);
    }
    return true;
  }

  return false;
}

// ── Comment actions ──────────────────────────────────────────────

function handleCommentActions(
  input: string,
  ctx: DiffViewerHandlerCtx,
  fileComments: ReviewComment[],
  maxScroll: number
): boolean {
  if (input === 'x' && ctx.pane.selectedCommentId && ctx.commentCtx) {
    ctx.pane.setPendingDeleteCommentId(ctx.pane.selectedCommentId);
    return true;
  }

  if (input === 'e' && ctx.pane.selectedCommentId) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (comment) {
      ctx.pane.setEditingCommentId(comment.id);
      ctx.pane.setEditBuffer(comment.body);
    }
    return true;
  }

  if (input === 'p' && ctx.pane.selectedCommentId && ctx.commentCtx) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (!comment || comment.status !== 'draft') return true;

    const pr = ctx.commentCtx.selectedReviewPr;

    const vendor = ctx.config.config.vendor;
    if (!vendor) {
      ctx.sessions.flashStatus('No VCS configured');
      return true;
    }
    if (vendor !== 'github' && vendor !== 'azure-devops') {
      ctx.sessions.flashStatus(`Unsupported vendor: ${vendor}`);
      return true;
    }
    if (vendor === 'github' && !pr.headSha) {
      ctx.sessions.flashStatus('Missing head SHA — try refreshing PR data');
      return true;
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
    updateComment(prId, postedId, { status: 'posting' });
    ctx.sessions.flashStatus('Posting comment...');

    postReviewComments([comment], postCtx)
      .then(() => {
        ctx.sessions.flashStatus('Comment posted');
        const freshComments = readComments(prId).filter(
          (c) => c.file === ctx.pane.diffViewFile
        );
        const nextDraftId = findAdjacentCommentId(
          'next',
          postedId,
          freshComments,
          ctx.commentCtx?.positions,
          (c) => c.status === 'draft'
        );
        if (nextDraftId) {
          ctx.pane.setSelectedCommentId(nextDraftId);
          scrollToComment(nextDraftId, ctx, maxScroll);
        } else {
          ctx.pane.setSelectedCommentId(null);
        }
      })
      .catch((err: Error) => {
        updateComment(prId, postedId, { status: 'draft' });
        ctx.sessions.flashStatus(`Post failed: ${err.message}`);
      });
    return true;
  }

  if (input === 'E' && ctx.pane.selectedCommentId && ctx.commentCtx) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (!comment) return true;

    const editor =
      ctx.config.config.editor || process.env.VISUAL || process.env.EDITOR;
    if (!editor) {
      ctx.sessions.flashStatus(
        'No editor configured — set one in settings (s)'
      );
      return true;
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
    return true;
  }

  return false;
}

// ── Main entry point ─────────────────────────────────────────────

export function handleDiffViewerInput(
  input: string,
  key: Key,
  ctx: DiffViewerHandlerCtx
): void {
  const viewportHeight = Math.max(1, ctx.terminal.paneRows - 3);
  const maxScroll = Math.max(0, ctx.diffTotalLines - viewportHeight);
  const fileComments = (ctx.commentCtx?.comments ?? []).filter(
    (c) => c.file === ctx.pane.diffViewFile
  );

  // ── Inline edit mode ──
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

  // ── Delete confirmation mode ──
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

  // ── Normal navigation ──
  if (key.escape) {
    ctx.pane.setPaneMode('diff');
    ctx.pane.setDiffViewFile(null);
    return;
  }

  if (handleDiffScroll(input, key, ctx, viewportHeight, maxScroll)) return;
  if (handleDiffFileNav(input, ctx)) return;
  if (handleCommentNav(input, key, ctx, fileComments, maxScroll)) return;
  handleCommentActions(input, ctx, fileComments, maxScroll);
}
