import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Key } from 'ink';
import { createWorktree } from '@kirby/worktree-manager';
import type { DiffFile, ReviewComment } from '../../types.js';
import { spawnSession, hasSession } from '../../pty-registry.js';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { handleTextInput } from '../../utils/handle-text-input.js';
import { removeComment, updateComment } from '../../utils/comment-store.js';
import {
  postReviewComments,
  type PostContext,
} from '../../utils/comment-poster.js';
import { getDisplayFiles } from '../../utils/file-classifier.js';
import type { CommentPositionInfo } from '../../utils/comment-renderer.js';
import type { SessionContextValue } from '../../context/SessionContext.js';
import type { ReviewContextValue } from '../../context/ReviewContext.js';
import type { ConfigContextValue } from '../../context/ConfigContext.js';
import type {
  NavValue,
  AsyncOpsValue,
  SettingsValue,
  TerminalLayout,
} from '../../input-handlers.js';
import { handleTabSwitchInput } from '../../input-handlers.js';

// ── Context slice types ──────────────────────────────────────────

type ReviewValue = ReviewContextValue['review'];

export interface ReviewConfirmHandlerCtx {
  review: ReviewValue;
  nav: NavValue;
  asyncOps: AsyncOpsValue;
  sessions: SessionContextValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
  selectedReviewPr: PullRequestInfo | undefined;
  reviewSessionName: string | null;
}

export interface DiffFileListHandlerCtx {
  review: ReviewValue;
  diffFiles: DiffFile[];
  diffDisplayCount: number;
  loadDiffText: () => Promise<void>;
}

export interface DiffViewerHandlerCtx {
  review: ReviewValue;
  diffFiles: DiffFile[];
  terminal: TerminalLayout;
  diffTotalLines: number;
  comments?: ReviewComment[];
  prId?: number;
  commentPositions?: Map<string, CommentPositionInfo>;
  selectedReviewPr?: PullRequestInfo;
  config: ConfigContextValue;
  sessions: SessionContextValue;
}

/**
 * Context for the reviews sidebar input handler.
 *
 * Dispatches navigation (j/k), tab switching (1/2), focus toggling (tab),
 * and review actions (d/r/s/enter/q). Needs session context for PR refresh
 * and status flashing, and review context for pane/selection management.
 */
export interface ReviewsSidebarCtx {
  nav: NavValue;
  config: ConfigContextValue;
  sessions: SessionContextValue;
  settings: SettingsValue;
  review: ReviewValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  reviewSelectedIndex: number;
  reviewTotalItems: number;
  reviewSessionName: string | null;
  selectedReviewPr: PullRequestInfo | undefined;
  exit: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

async function startReviewSession(
  ctx: ReviewConfirmHandlerCtx,
  additionalInstruction?: string
): Promise<void> {
  if (!ctx.reviewSessionName || !ctx.selectedReviewPr) return;
  const pr = ctx.selectedReviewPr;

  let prompt =
    `Review PR #${pr.id} ("${pr.title || pr.sourceBranch}") ` +
    `merging ${pr.sourceBranch} → ${pr.targetBranch} ` +
    `by ${pr.createdByDisplayName || 'unknown'}.\n\n` +
    `To add review comments, use this command:\n` +
    `  kirby util add-comment --pr=${pr.id} --file=<path> --lineStart=<n> --lineEnd=<n> --severity=<critical|major|minor|nit> --body="<comment>"\n\n` +
    `Rules:\n` +
    `- File paths are relative to the repo root\n` +
    `- lineStart/lineEnd are 1-based line numbers in the NEW version of the file\n` +
    `- Use --side=LEFT only when commenting on removed/deleted lines\n` +
    `- Severity: critical (blocks merge), major (should fix), minor (nice to fix), nit (style/preference)\n` +
    `- Comments appear live in the reviewer's diff viewer\n\n` +
    `Review all changed files thoroughly. Add comments for any issues found.`;

  if (additionalInstruction) {
    prompt +=
      ` ADDITIONAL USER INSTRUCTION (overrides previous where applicable): ` +
      additionalInstruction;
  }

  const worktreePath = await createWorktree(pr.sourceBranch);
  if (!worktreePath) {
    ctx.sessions.flashStatus(
      `Failed to create worktree for ${pr.sourceBranch}`
    );
    return;
  }

  const safePrompt = prompt.replace(/['"]/g, '');
  const command = `claude --continue || claude '${safePrompt}'`;

  spawnSession(
    ctx.reviewSessionName,
    '/bin/sh',
    ['-c', command],
    ctx.terminal.paneCols,
    ctx.terminal.paneRows,
    worktreePath
  );
  ctx.review.setReviewSessionStarted((prev) => new Set([...prev, pr.id]));
}

const REVIEW_CONFIRM_OPTIONS = 3;

// ── Input handlers ───────────────────────────────────────────────

export function handleReviewConfirmInput(
  input: string,
  key: Key,
  ctx: ReviewConfirmHandlerCtx
): void {
  const confirm = ctx.review.reviewConfirm!;
  const opt = confirm.selectedOption;

  if (key.escape) {
    ctx.review.setReviewConfirm(null);
    ctx.review.setReviewInstruction('');
    ctx.review.setReviewPane('detail');
    return;
  }

  if (opt === 1) {
    if (key.return) {
      ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.reviewSessionName!)) {
          await startReviewSession(
            ctx,
            ctx.review.reviewInstruction || undefined
          );
        }
        ctx.review.setReviewPane('terminal');
        ctx.nav.setFocus('terminal');
        ctx.review.setReviewReconnectKey((k) => k + 1);
        ctx.review.setReviewConfirm(null);
        ctx.review.setReviewInstruction('');
      });
      return;
    }
    if (key.upArrow || (input === 'k' && key.ctrl)) {
      ctx.review.setReviewConfirm({ ...confirm, selectedOption: 0 });
      return;
    }
    if (key.downArrow || (input === 'j' && key.ctrl)) {
      ctx.review.setReviewConfirm({ ...confirm, selectedOption: 2 });
      return;
    }
    handleTextInput(input, key, ctx.review.setReviewInstruction);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.review.setReviewConfirm({
      ...confirm,
      selectedOption: Math.min(opt + 1, REVIEW_CONFIRM_OPTIONS - 1),
    });
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.review.setReviewConfirm({
      ...confirm,
      selectedOption: Math.max(opt - 1, 0),
    });
    return;
  }

  if (key.return) {
    if (opt === 0) {
      ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.reviewSessionName!)) {
          await startReviewSession(ctx);
        }
        ctx.review.setReviewPane('terminal');
        ctx.nav.setFocus('terminal');
        ctx.review.setReviewReconnectKey((k) => k + 1);
        ctx.review.setReviewConfirm(null);
      });
    } else if (opt === 2) {
      ctx.review.setReviewConfirm(null);
      ctx.review.setReviewInstruction('');
    }
  }
}

export function handleDiffFileListInput(
  input: string,
  key: Key,
  ctx: DiffFileListHandlerCtx
): void {
  if (key.escape) {
    ctx.review.setReviewPane('detail');
    return;
  }

  if (input === 's') {
    ctx.review.setShowSkipped((v) => !v);
    ctx.review.setDiffFileIndex(0);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.review.setDiffFileIndex((i) =>
      Math.min(i + 1, ctx.diffDisplayCount - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.review.setDiffFileIndex((i) => Math.max(i - 1, 0));
    return;
  }

  if (key.return && ctx.diffDisplayCount > 0) {
    const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.review.showSkipped);
    const file = displayFiles[ctx.review.diffFileIndex];
    if (file) {
      ctx.review.setDiffViewFile(file.filename);
      ctx.review.setDiffScrollOffset(0);
      ctx.review.setReviewPane('diff-file');
      ctx.loadDiffText();
    }
    return;
  }
}

export function handleDiffViewerInput(
  input: string,
  key: Key,
  ctx: DiffViewerHandlerCtx
): void {
  const viewportHeight = Math.max(1, ctx.terminal.paneRows - 3);
  const maxScroll = Math.max(0, ctx.diffTotalLines - viewportHeight);
  const fileComments = (ctx.comments ?? []).filter(
    (c) => c.file === ctx.review.diffViewFile
  );

  // ── Inline edit mode ────────────────────────────────────────────
  if (ctx.review.editingCommentId) {
    if (key.escape) {
      // Save
      if (ctx.prId) {
        updateComment(ctx.prId, ctx.review.editingCommentId, {
          body: ctx.review.editBuffer,
        });
      }
      ctx.review.setEditingCommentId(null);
      ctx.review.setEditBuffer('');
      return;
    }
    if (input === 'c' && key.ctrl) {
      // Cancel without saving
      ctx.review.setEditingCommentId(null);
      ctx.review.setEditBuffer('');
      return;
    }
    if (key.return) {
      ctx.review.setEditBuffer((b) => b + '\n');
      return;
    }
    handleTextInput(input, key, ctx.review.setEditBuffer);
    return;
  }

  // ── Delete confirmation mode ────────────────────────────────────
  if (ctx.review.pendingDeleteCommentId) {
    if (input === 'y' && ctx.prId) {
      removeComment(ctx.prId, ctx.review.pendingDeleteCommentId);
      ctx.review.setPendingDeleteCommentId(null);
      ctx.review.setSelectedCommentId(null);
      return;
    }
    if (input === 'n' || key.escape) {
      ctx.review.setPendingDeleteCommentId(null);
      return;
    }
    // Swallow all other input while confirming
    return;
  }

  // ── Normal navigation ───────────────────────────────────────────
  if (key.escape) {
    ctx.review.setReviewPane('diff');
    ctx.review.setDiffViewFile(null);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.review.setDiffScrollOffset((o) => Math.min(o + 1, maxScroll));
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.review.setDiffScrollOffset((o) => Math.max(o - 1, 0));
    return;
  }
  if (input === 'd') {
    const half = Math.floor(viewportHeight / 2);
    ctx.review.setDiffScrollOffset((o) => Math.min(o + half, maxScroll));
    return;
  }
  if (input === 'u') {
    const half = Math.floor(viewportHeight / 2);
    ctx.review.setDiffScrollOffset((o) => Math.max(o - half, 0));
    return;
  }
  if (key.pageDown) {
    ctx.review.setDiffScrollOffset((o) =>
      Math.min(o + viewportHeight, maxScroll)
    );
    return;
  }
  if (key.pageUp) {
    ctx.review.setDiffScrollOffset((o) => Math.max(o - viewportHeight, 0));
    return;
  }
  if (input === 'g') {
    ctx.review.setDiffScrollOffset(0);
    return;
  }
  if (input === 'G') {
    ctx.review.setDiffScrollOffset(maxScroll);
    return;
  }
  if (input === 'n') {
    const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.review.showSkipped);
    const currentIdx = displayFiles.findIndex(
      (f) => f.filename === ctx.review.diffViewFile
    );
    if (currentIdx >= 0 && currentIdx < displayFiles.length - 1) {
      const nextFile = displayFiles[currentIdx + 1]!;
      ctx.review.setDiffViewFile(nextFile.filename);
      ctx.review.setDiffFileIndex(currentIdx + 1);
      ctx.review.setDiffScrollOffset(0);
    }
    return;
  }
  if (input === 'N') {
    const displayFiles = getDisplayFiles(ctx.diffFiles, ctx.review.showSkipped);
    const currentIdx = displayFiles.findIndex(
      (f) => f.filename === ctx.review.diffViewFile
    );
    if (currentIdx > 0) {
      const prevFile = displayFiles[currentIdx - 1]!;
      ctx.review.setDiffViewFile(prevFile.filename);
      ctx.review.setDiffFileIndex(currentIdx - 1);
      ctx.review.setDiffScrollOffset(0);
    }
    return;
  }

  // ── Comment navigation & actions ──────────────────────────────

  // Helper: scroll so the referenced lines (lineStart) are visible above the comment
  function scrollToComment(commentId: string) {
    const positions = ctx.commentPositions;
    if (!positions) return;
    const info = positions.get(commentId);
    if (!info) return;
    // Scroll so refStartLine is near the top with a small margin
    const scrollTarget = Math.max(0, info.refStartLine - 2);
    ctx.review.setDiffScrollOffset(Math.min(scrollTarget, maxScroll));
  }

  if ((input === 'c' || key.rightArrow) && fileComments.length > 0) {
    const positions = ctx.commentPositions;

    if (positions && positions.size > 0) {
      const currentId = ctx.review.selectedCommentId;
      const currentInfo = currentId ? positions.get(currentId) : undefined;
      const currentHeader = currentInfo?.headerLine ?? -1;

      // Sort comments by header position
      const sorted = fileComments
        .map((c) => ({
          id: c.id,
          pos: positions.get(c.id)?.headerLine ?? Infinity,
        }))
        .sort((a, b) => a.pos - b.pos);

      // Find next comment after current
      let next = sorted.find(
        (c) => c.pos > currentHeader && c.id !== currentId
      );
      // Wrap to first
      if (!next) next = sorted[0];

      if (next) {
        ctx.review.setSelectedCommentId(next.id);
        scrollToComment(next.id);
      }
    } else {
      // Fallback: cycle by array index
      const currentId = ctx.review.selectedCommentId;
      const currentIdx = currentId
        ? fileComments.findIndex((c) => c.id === currentId)
        : -1;
      const nextIdx = (currentIdx + 1) % fileComments.length;
      ctx.review.setSelectedCommentId(fileComments[nextIdx].id);
    }
    return;
  }

  if ((input === 'C' || key.leftArrow) && fileComments.length > 0) {
    const positions = ctx.commentPositions;

    if (positions && positions.size > 0) {
      const currentId = ctx.review.selectedCommentId;
      const currentInfo = currentId ? positions.get(currentId) : undefined;
      const currentHeader = currentInfo?.headerLine ?? Infinity;

      // Sort comments by header position descending
      const sorted = fileComments
        .map((c) => ({ id: c.id, pos: positions.get(c.id)?.headerLine ?? -1 }))
        .sort((a, b) => b.pos - a.pos);

      // Find previous comment before current
      let prev = sorted.find(
        (c) => c.pos < currentHeader && c.id !== currentId
      );
      // Wrap to last
      if (!prev) prev = sorted[0];

      if (prev) {
        ctx.review.setSelectedCommentId(prev.id);
        scrollToComment(prev.id);
      }
    } else {
      // Fallback: cycle by array index
      const currentId = ctx.review.selectedCommentId;
      const currentIdx = currentId
        ? fileComments.findIndex((c) => c.id === currentId)
        : 0;
      const prevIdx =
        currentIdx <= 0 ? fileComments.length - 1 : currentIdx - 1;
      ctx.review.setSelectedCommentId(fileComments[prevIdx].id);
    }
    return;
  }

  if (input === 'x' && ctx.review.selectedCommentId && ctx.prId) {
    ctx.review.setPendingDeleteCommentId(ctx.review.selectedCommentId);
    return;
  }

  if (input === 'e' && ctx.review.selectedCommentId) {
    const comment = fileComments.find(
      (c) => c.id === ctx.review.selectedCommentId
    );
    if (comment) {
      ctx.review.setEditingCommentId(comment.id);
      ctx.review.setEditBuffer(comment.body);
    }
    return;
  }

  if (input === 'p' && ctx.review.selectedCommentId && ctx.prId) {
    const comment = fileComments.find(
      (c) => c.id === ctx.review.selectedCommentId
    );
    if (!comment || comment.status === 'posted') return;

    const pr = ctx.selectedReviewPr;
    if (!pr) return;

    const vendor = ctx.config.config.vendor;
    if (!vendor) {
      ctx.sessions.flashStatus('No VCS configured');
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
      prId: ctx.prId,
      headSha: pr.headSha,
    };

    ctx.sessions.flashStatus('Posting comment...');
    const postedId = comment.id;
    postReviewComments([comment], postCtx)
      .then(() => {
        ctx.sessions.flashStatus('Comment posted');
        // Navigate to next unposted comment if one exists
        const remaining = fileComments.filter(
          (c) => c.id !== postedId && c.status !== 'posted'
        );
        if (remaining.length > 0) {
          const positions = ctx.commentPositions;
          const postedPos = positions?.get(postedId)?.headerLine ?? -1;
          // Pick next comment after the posted one by position, or wrap to first
          const sorted = remaining
            .map((c) => ({
              id: c.id,
              pos: positions?.get(c.id)?.headerLine ?? Infinity,
            }))
            .sort((a, b) => a.pos - b.pos);
          const next = sorted.find((c) => c.pos > postedPos) ?? sorted[0];
          if (next) {
            ctx.review.setSelectedCommentId(next.id);
            scrollToComment(next.id);
          }
        } else {
          ctx.review.setSelectedCommentId(null);
        }
      })
      .catch((err: Error) =>
        ctx.sessions.flashStatus(`Post failed: ${err.message}`)
      );
    return;
  }

  if (input === 'E' && ctx.review.selectedCommentId && ctx.prId) {
    const comment = fileComments.find(
      (c) => c.id === ctx.review.selectedCommentId
    );
    if (!comment) return;

    const editor =
      ctx.config.config.editor || process.env.VISUAL || process.env.EDITOR;
    if (!editor) {
      ctx.sessions.flashStatus(
        'No editor configured — set one in settings (s)'
      );
      return;
    }

    const tmpFile = join(tmpdir(), `kirby-comment-${comment.id}.md`);
    writeFileSync(tmpFile, comment.body, 'utf8');

    spawn(editor, [tmpFile], {
      detached: true,
      stdio: 'ignore',
    }).unref();

    const prId = ctx.prId;
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

    // Cleanup after 30 minutes
    setTimeout(() => {
      watcher.close();
    }, 30 * 60 * 1000);

    ctx.sessions.flashStatus(`Opened comment in ${editor}`);
    return;
  }
}

export function handleReviewsSidebarInput(
  input: string,
  key: Key,
  ctx: ReviewsSidebarCtx
): void {
  if (handleTabSwitchInput(input, ctx.nav, ctx.config.vcsConfigured)) return;

  // Tab focus toggle
  if (key.tab) {
    if (
      ctx.nav.focus === 'sidebar' &&
      ctx.reviewSessionName &&
      ctx.selectedReviewPr
    ) {
      ctx.asyncOps.run('start-session', async () => {
        if (hasSession(ctx.reviewSessionName!)) {
          ctx.review.setReviewPane('terminal');
          ctx.review.setReviewReconnectKey((k) => k + 1);
          ctx.nav.setFocus('terminal');
        } else {
          ctx.review.setReviewPane('confirm');
          ctx.review.setReviewConfirm({
            pr: ctx.selectedReviewPr!,
            selectedOption: 0,
          });
        }
      });
    } else if (ctx.nav.focus === 'terminal') {
      ctx.nav.setFocus('sidebar');
      ctx.review.setReviewPane('detail');
    }
    return;
  }

  // Sidebar actions
  if (input === 'q') {
    ctx.exit();
    return;
  }
  if (input === 'r') {
    ctx.sessions.refreshPr();
    ctx.sessions.flashStatus('Refreshing PR data...');
    return;
  }
  if (input === 's') {
    ctx.settings.setSettingsOpen(true);
    ctx.settings.setSettingsFieldIndex(0);
    return;
  }
  if (input === 'd' && ctx.selectedReviewPr) {
    ctx.review.setReviewPane('diff');
    ctx.review.setDiffFileIndex(0);
    return;
  }
  if (key.return && ctx.reviewSessionName && ctx.selectedReviewPr) {
    ctx.asyncOps.run('start-session', async () => {
      if (hasSession(ctx.reviewSessionName!)) {
        ctx.review.setReviewPane('terminal');
        ctx.nav.setFocus('terminal');
        ctx.review.setReviewReconnectKey((k) => k + 1);
        return;
      }
      ctx.review.setReviewPane('confirm');
      ctx.review.setReviewConfirm({
        pr: ctx.selectedReviewPr!,
        selectedOption: 0,
      });
    });
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.review.setReviewSelectedIndex((i) =>
      Math.min(i + 1, ctx.reviewTotalItems - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.review.setReviewSelectedIndex((i) => Math.max(i - 1, 0));
    return;
  }
}
