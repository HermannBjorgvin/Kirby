import { spawn } from 'node:child_process';
import type { Key } from 'ink';
import {
  createWorktree,
  canRemoveBranch,
  listAllBranches,
  listWorktrees,
  fetchRemote,
  branchToSessionName,
  rebaseOntoMaster,
} from '@kirby/worktree-manager';
import { spawnSession, hasSession, killSession } from '../../pty-registry.js';
import type { AppConfig, PullRequestInfo } from '@kirby/vcs-core';
import type { DiffFile, ReviewComment, SidebarItem } from '../../types.js';
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
import { getDisplayFiles } from '../../utils/file-classifier.js';
import type { CommentPositionInfo } from '../../utils/comment-renderer.js';
import type { AppStateContextValue } from '../../context/AppStateContext.js';
import type { SessionContextValue } from '../../context/SessionContext.js';
import type { ConfigContextValue } from '../../context/ConfigContext.js';
import type { SidebarContextValue } from '../../context/SidebarContext.js';
import type {
  NavValue,
  AsyncOpsValue,
  SettingsValue,
  TerminalLayout,
} from '../../input-handlers.js';
import { usePaneMode } from '../../hooks/usePaneMode.js';
import { writeFileSync, readFileSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── Context slice types ──────────────────────────────────────────

type BranchPickerValue = AppStateContextValue['branchPicker'];
type DeleteConfirmValue = AppStateContextValue['deleteConfirm'];
type PaneModeValue = ReturnType<typeof usePaneMode>;

// ── Shared context interfaces ────────────────────────────────────

export interface BranchPickerHandlerCtx {
  branchPicker: BranchPickerValue;
  sessions: SessionContextValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
}

export interface DeleteConfirmHandlerCtx {
  deleteConfirm: DeleteConfirmValue;
  sessions: SessionContextValue;
  asyncOps: AsyncOpsValue;
}

export interface DiffFileListHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  diffDisplayCount: number;
  loadDiffText: () => Promise<void>;
}

export interface CommentContext {
  comments: ReviewComment[];
  prId: number;
  positions: Map<string, CommentPositionInfo>;
  selectedReviewPr: PullRequestInfo;
}

export interface DiffViewerHandlerCtx {
  pane: PaneModeValue;
  diffFiles: DiffFile[];
  terminal: TerminalLayout;
  diffTotalLines: number;
  commentCtx?: CommentContext;
  config: ConfigContextValue;
  sessions: SessionContextValue;
}

export interface ConfirmHandlerCtx {
  pane: PaneModeValue;
  nav: NavValue;
  asyncOps: AsyncOpsValue;
  sessions: SessionContextValue;
  sidebar: SidebarContextValue;
  terminal: TerminalLayout;
  config: ConfigContextValue;
  selectedItem: SidebarItem | undefined;
  sessionNameForTerminal: string | null;
}

export interface SidebarInputCtx {
  nav: NavValue;
  config: ConfigContextValue;
  sessions: SessionContextValue;
  sidebar: SidebarContextValue;
  branchPicker: BranchPickerValue;
  deleteConfirm: DeleteConfirmValue;
  settings: SettingsValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  pane: PaneModeValue;
  exit: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

const DEFAULT_AI_COMMAND = 'claude --continue || claude';

function startAiSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
  config: AppConfig
) {
  const cmd = config.aiCommand || DEFAULT_AI_COMMAND;
  spawnSession(name, '/bin/sh', ['-c', cmd], cols, rows, cwd);
}

async function startReviewSession(
  ctx: ConfirmHandlerCtx,
  additionalInstruction?: string
): Promise<void> {
  if (!ctx.sessionNameForTerminal || !ctx.selectedItem) return;
  const pr =
    ctx.selectedItem.kind === 'session'
      ? ctx.selectedItem.pr
      : ctx.selectedItem.pr;
  if (!pr) return;

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
    ctx.sessionNameForTerminal,
    '/bin/sh',
    ['-c', command],
    ctx.terminal.paneCols,
    ctx.terminal.paneRows,
    worktreePath
  );
  ctx.pane.setReviewSessionStarted((prev) => new Set([...prev, pr.id]));
}

// ── Branch picker input handler ──────────────────────────────────

export function handleBranchPickerInput(
  input: string,
  key: Key,
  ctx: BranchPickerHandlerCtx
): void {
  if (key.escape) {
    ctx.branchPicker.setCreating(false);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
    return;
  }

  if (key.ctrl && input === 'f') {
    ctx.asyncOps.run('fetch-branches', async () => {
      ctx.sessions.flashStatus('Fetching remotes...');
      await fetchRemote();
      const allBranches = await listAllBranches();
      ctx.branchPicker.setBranches(allBranches);
      ctx.branchPicker.setBranchIndex(0);
      ctx.sessions.flashStatus('Fetched remotes');
    });
    return;
  }

  const filtered = ctx.branchPicker.branches.filter((b) =>
    b.toLowerCase().includes(ctx.branchPicker.branchFilter.toLowerCase())
  );

  if (key.upArrow) {
    ctx.branchPicker.setBranchIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (key.downArrow) {
    ctx.branchPicker.setBranchIndex((i) =>
      Math.min(i + 1, filtered.length - 1)
    );
    return;
  }

  if (key.return) {
    const branch =
      filtered.length > 0
        ? filtered[ctx.branchPicker.branchIndex]!
        : ctx.branchPicker.branchFilter.trim();
    if (branch) {
      ctx.asyncOps.run('create-worktree', async () => {
        const worktreePath = await createWorktree(branch);
        if (worktreePath) {
          const sessionName = branchToSessionName(branch);
          startAiSession(
            sessionName,
            ctx.terminal.paneCols,
            ctx.terminal.paneRows,
            worktreePath,
            ctx.config.config
          );
          const updated = await ctx.sessions.refreshSessions();
          const idx = ctx.sessions.findSortedIndex(updated, sessionName);
          if (idx >= 0) ctx.sessions.setSelectedIndex(idx);
        }
      });
    }
    ctx.branchPicker.setCreating(false);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
    return;
  }

  if (handleTextInput(input, key, ctx.branchPicker.setBranchFilter)) {
    ctx.branchPicker.setBranchIndex(0);
  }
}

// ── Delete confirm input handler ─────────────────────────────────

export function handleConfirmDeleteInput(
  input: string,
  key: Key,
  ctx: DeleteConfirmHandlerCtx
): void {
  if (key.escape) {
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  if (key.return) {
    if (
      ctx.deleteConfirm.confirmInput === ctx.deleteConfirm.confirmDelete!.branch
    ) {
      ctx.asyncOps.run('delete', async () => {
        await ctx.sessions.performDelete(
          ctx.deleteConfirm.confirmDelete!.sessionName,
          ctx.deleteConfirm.confirmDelete!.branch
        );
      });
    } else {
      ctx.sessions.flashStatus('Branch name did not match — delete cancelled');
    }
    ctx.deleteConfirm.setConfirmDelete(null);
    ctx.deleteConfirm.setConfirmInput('');
    return;
  }
  handleTextInput(input, key, ctx.deleteConfirm.setConfirmInput);
}

// ── Diff file list input handler ─────────────────────────────────

export function handleDiffFileListInput(
  input: string,
  key: Key,
  ctx: DiffFileListHandlerCtx
): void {
  if (key.escape) {
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  if (input === 's') {
    ctx.pane.setShowSkipped((v) => !v);
    ctx.pane.setDiffFileIndex(0);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.pane.setDiffFileIndex((i) =>
      Math.min(i + 1, ctx.diffDisplayCount - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.pane.setDiffFileIndex((i) => Math.max(i - 1, 0));
    return;
  }

  if (key.return && ctx.diffDisplayCount > 0) {
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

// ── Diff viewer input handler ────────────────────────────────────

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

  if (input === 'j' || key.downArrow) {
    ctx.pane.setDiffScrollOffset((o) => Math.min(o + 1, maxScroll));
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - 1, 0));
    return;
  }
  if (input === 'd') {
    const half = Math.floor(viewportHeight / 2);
    ctx.pane.setDiffScrollOffset((o) => Math.min(o + half, maxScroll));
    return;
  }
  if (input === 'u') {
    const half = Math.floor(viewportHeight / 2);
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - half, 0));
    return;
  }
  if (key.pageDown) {
    ctx.pane.setDiffScrollOffset((o) =>
      Math.min(o + viewportHeight, maxScroll)
    );
    return;
  }
  if (key.pageUp) {
    ctx.pane.setDiffScrollOffset((o) => Math.max(o - viewportHeight, 0));
    return;
  }
  if (input === 'g') {
    ctx.pane.setDiffScrollOffset(0);
    return;
  }
  if (input === 'G') {
    ctx.pane.setDiffScrollOffset(maxScroll);
    return;
  }
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
    return;
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
    return;
  }

  // ── Comment navigation & actions ──

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

  function scrollToComment(commentId: string) {
    const positions = ctx.commentCtx?.positions;
    if (!positions) return;
    const info = positions.get(commentId);
    if (!info) return;
    const scrollTarget = Math.max(0, info.refStartLine - 2);
    ctx.pane.setDiffScrollOffset(Math.min(scrollTarget, maxScroll));
  }

  if ((input === 'c' || key.rightArrow) && fileComments.length > 0) {
    const nextId = findAdjacentCommentId(
      'next',
      ctx.pane.selectedCommentId,
      fileComments,
      ctx.commentCtx?.positions
    );
    if (nextId) {
      ctx.pane.setSelectedCommentId(nextId);
      scrollToComment(nextId);
    }
    return;
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
      scrollToComment(prevId);
    }
    return;
  }

  if (input === 'x' && ctx.pane.selectedCommentId && ctx.commentCtx) {
    ctx.pane.setPendingDeleteCommentId(ctx.pane.selectedCommentId);
    return;
  }

  if (input === 'e' && ctx.pane.selectedCommentId) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
    );
    if (comment) {
      ctx.pane.setEditingCommentId(comment.id);
      ctx.pane.setEditBuffer(comment.body);
    }
    return;
  }

  if (input === 'p' && ctx.pane.selectedCommentId && ctx.commentCtx) {
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
          scrollToComment(nextDraftId);
        } else {
          ctx.pane.setSelectedCommentId(null);
        }
      })
      .catch((err: Error) => {
        updateComment(prId, postedId, { status: 'draft' });
        ctx.sessions.flashStatus(`Post failed: ${err.message}`);
      });
    return;
  }

  if (input === 'E' && ctx.pane.selectedCommentId && ctx.commentCtx) {
    const comment = fileComments.find(
      (c) => c.id === ctx.pane.selectedCommentId
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
}

// ── Confirm dialog input handler ─────────────────────────────────

const CONFIRM_OPTIONS = 4;

export function handleConfirmInput(
  input: string,
  key: Key,
  ctx: ConfirmHandlerCtx
): void {
  const confirm = ctx.pane.reviewConfirm!;
  const opt = confirm.selectedOption;

  if (key.escape) {
    ctx.pane.setReviewConfirm(null);
    ctx.pane.setReviewInstruction('');
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  // Option 2: Add instructions (text input mode)
  if (opt === 2) {
    if (key.return) {
      ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.sessionNameForTerminal!)) {
          await startReviewSession(
            ctx,
            ctx.pane.reviewInstruction || undefined
          );
        }
        const updated = await ctx.sessions.refreshSessions();
        // Review PRs stay in their section — only reposition for non-review items
        if (ctx.selectedItem?.kind !== 'review-pr') {
          const idx = ctx.sessions.findSortedIndex(updated, ctx.sessionNameForTerminal!);
          if (idx >= 0) ctx.sidebar.setSelectedIndex(idx);
        }
        ctx.pane.setPaneMode('terminal');
        ctx.nav.setFocus('terminal');
        ctx.pane.setReconnectKey((k) => k + 1);
        ctx.pane.setReviewConfirm(null);
        ctx.pane.setReviewInstruction('');
      });
      return;
    }
    if (key.upArrow || (input === 'k' && key.ctrl)) {
      ctx.pane.setReviewConfirm({ ...confirm, selectedOption: 1 });
      return;
    }
    if (key.downArrow || (input === 'j' && key.ctrl)) {
      ctx.pane.setReviewConfirm({ ...confirm, selectedOption: 3 });
      return;
    }
    handleTextInput(input, key, ctx.pane.setReviewInstruction);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.pane.setReviewConfirm({
      ...confirm,
      selectedOption: Math.min(opt + 1, CONFIRM_OPTIONS - 1),
    });
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.pane.setReviewConfirm({
      ...confirm,
      selectedOption: Math.max(opt - 1, 0),
    });
    return;
  }

  if (key.return) {
    // Option 0: Start session (plain AI session)
    if (opt === 0) {
      ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.sessionNameForTerminal!)) {
          const pr =
            ctx.selectedItem?.kind === 'session'
              ? ctx.selectedItem.pr
              : ctx.selectedItem?.pr;
          if (pr) {
            const worktreePath = await createWorktree(pr.sourceBranch);
            if (worktreePath) {
              startAiSession(
                ctx.sessionNameForTerminal!,
                ctx.terminal.paneCols,
                ctx.terminal.paneRows,
                worktreePath,
                ctx.config.config
              );
            }
          }
        }
        const updated = await ctx.sessions.refreshSessions();
        if (ctx.selectedItem?.kind !== 'review-pr') {
          const idx = ctx.sessions.findSortedIndex(updated, ctx.sessionNameForTerminal!);
          if (idx >= 0) ctx.sidebar.setSelectedIndex(idx);
        }
        ctx.pane.setPaneMode('terminal');
        ctx.nav.setFocus('terminal');
        ctx.pane.setReconnectKey((k) => k + 1);
        ctx.pane.setReviewConfirm(null);
      });
    }
    // Option 1: Start review
    else if (opt === 1) {
      ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.sessionNameForTerminal!)) {
          await startReviewSession(ctx);
        }
        const updated = await ctx.sessions.refreshSessions();
        if (ctx.selectedItem?.kind !== 'review-pr') {
          const idx = ctx.sessions.findSortedIndex(updated, ctx.sessionNameForTerminal!);
          if (idx >= 0) ctx.sidebar.setSelectedIndex(idx);
        }
        ctx.pane.setPaneMode('terminal');
        ctx.nav.setFocus('terminal');
        ctx.pane.setReconnectKey((k) => k + 1);
        ctx.pane.setReviewConfirm(null);
      });
    }
    // Option 3: Cancel
    else if (opt === 3) {
      ctx.pane.setReviewConfirm(null);
      ctx.pane.setReviewInstruction('');
    }
  }
}

// ── Sidebar input handler ────────────────────────────────────────

export function handleSidebarInput(
  input: string,
  key: Key,
  ctx: SidebarInputCtx
): void {
  const { sidebar, pane } = ctx;
  const selectedItem = sidebar.selectedItem;

  // Tab focus toggle
  if (key.tab) {
    if (ctx.nav.focus === 'sidebar' && sidebar.sessionNameForTerminal) {
      ctx.asyncOps.run('start-session', async () => {
        if (!selectedItem) return;

        if (hasSession(sidebar.sessionNameForTerminal!)) {
          pane.setPaneMode('terminal');
          pane.setReconnectKey((k) => k + 1);
          ctx.nav.setFocus('terminal');
          return;
        }

        // Session item → auto-start PTY
        if (selectedItem.kind === 'session') {
          const worktrees = await listWorktrees();
          const wt = worktrees.find(
            (w) =>
              branchToSessionName(w.branch) === selectedItem.session.name
          );
          if (!wt) return;
          startAiSession(
            selectedItem.session.name,
            ctx.terminal.paneCols,
            ctx.terminal.paneRows,
            wt.path,
            ctx.config.config
          );
          await ctx.sessions.refreshSessions();
          pane.setReconnectKey((k) => k + 1);
          pane.setPaneMode('terminal');
          ctx.nav.setFocus('terminal');
          return;
        }

        // Review/orphan PR → show confirm dialog
        if (selectedItem.pr) {
          pane.setPaneMode('confirm');
          pane.setReviewConfirm({
            pr: selectedItem.pr,
            selectedOption: 0,
          });
        }
      });
    } else if (ctx.nav.focus === 'terminal') {
      ctx.nav.setFocus('sidebar');
    }
    return;
  }

  // Quit
  if (input === 'q') {
    ctx.exit();
    return;
  }

  // Create/checkout branch
  if (input === 'c') {
    ctx.asyncOps.run('fetch-branches', async () => {
      const allBranches = await listAllBranches();
      ctx.branchPicker.setBranches(allBranches);
      ctx.branchPicker.setCreating(true);
      ctx.branchPicker.setBranchFilter('');
      ctx.branchPicker.setBranchIndex(0);
    });
    return;
  }

  // Delete branch (was 'd', now 'x')
  if (
    input === 'x' &&
    selectedItem &&
    (selectedItem.kind === 'session' ||
      (selectedItem.kind === 'review-pr' && selectedItem.running != null))
  ) {
    const sessionName =
      selectedItem.kind === 'session'
        ? selectedItem.session.name
        : branchToSessionName(selectedItem.pr.sourceBranch);
    ctx.asyncOps.run('check-delete', async () => {
      const worktrees = await listWorktrees();
      const wt = worktrees.find(
        (w) => branchToSessionName(w.branch) === sessionName
      );
      const branch = wt?.branch;
      if (branch) {
        const check = await canRemoveBranch(branch);
        if (!check.safe) {
          if (
            check.reason === 'not pushed to upstream' ||
            check.reason === 'uncommitted changes'
          ) {
            ctx.deleteConfirm.setConfirmDelete({
              branch,
              sessionName,
              reason: check.reason,
            });
            ctx.deleteConfirm.setConfirmInput('');
          } else {
            ctx.sessions.flashStatus(`Cannot delete: ${check.reason}`);
          }
          return;
        }
        await ctx.sessions.performDelete(sessionName, branch);
      } else {
        killSession(sessionName);
        ctx.pane.setReconnectKey((k) => k + 1);
        const updated = await ctx.sessions.refreshSessions();
        if (sidebar.clampedIndex >= updated.length) {
          sidebar.setSelectedIndex(Math.max(0, updated.length - 1));
        }
      }
    });
    return;
  }

  // Kill agent
  if (
    input === 'K' &&
    selectedItem &&
    (selectedItem.kind === 'session' ||
      (selectedItem.kind === 'review-pr' && selectedItem.running != null))
  ) {
    const sessionName =
      selectedItem.kind === 'session'
        ? selectedItem.session.name
        : branchToSessionName(selectedItem.pr.sourceBranch);
    ctx.asyncOps.run('delete', async () => {
      killSession(sessionName);
      await ctx.sessions.refreshSessions();
    });
    ctx.pane.setReconnectKey((k) => k + 1);
    return;
  }

  // Settings
  if (input === 's') {
    ctx.settings.setSettingsOpen(true);
    ctx.settings.setSettingsFieldIndex(0);
    return;
  }

  // Refresh PR data
  if (input === 'r') {
    ctx.sessions.refreshPr();
    ctx.sessions.flashStatus('Refreshing PR data...');
    return;
  }

  // Rebase onto master
  if (input === 'u' && selectedItem?.kind === 'session') {
    const sessionName = selectedItem.session.name;
    ctx.asyncOps.run('rebase', async () => {
      const worktrees = await listWorktrees();
      const wt = worktrees.find(
        (w) => branchToSessionName(w.branch) === sessionName
      );
      if (!wt) {
        ctx.sessions.flashStatus('No worktree found for selected session');
        return;
      }
      ctx.sessions.flashStatus('Updating from origin...');
      const rebaseMessages = {
        success: 'Rebased onto origin successfully',
        conflict: 'Conflicts detected — rebase aborted',
        error: 'Failed to fetch from origin',
      } as const;
      ctx.sessions.flashStatus(rebaseMessages[await rebaseOntoMaster(wt.path)]);
    });
    return;
  }

  // Open in editor
  if (input === '.' && selectedItem?.kind === 'session') {
    const sessionName = selectedItem.session.name;
    ctx.asyncOps.run('open-editor', async () => {
      const worktrees = await listWorktrees();
      const wt = worktrees.find(
        (w) => branchToSessionName(w.branch) === sessionName
      );
      if (!wt) {
        ctx.sessions.flashStatus('No worktree found for selected session');
        return;
      }
      const editor =
        ctx.config.config.editor || process.env.VISUAL || process.env.EDITOR;
      if (!editor) {
        ctx.sessions.flashStatus(
          'No editor configured — set one in settings (s)'
        );
        return;
      }
      spawn(editor, [wt.path], { detached: true, stdio: 'ignore' }).unref();
      ctx.sessions.flashStatus(`Opened in ${editor}`);
    });
    return;
  }

  // Sync with origin
  if (input === 'g') {
    ctx.sessions.flashStatus('Syncing with origin...');
    ctx.sessions.triggerSync();
    return;
  }

  // View diff ('d' key — only when item has a PR)
  if (input === 'd' && selectedItem) {
    const pr =
      selectedItem.kind === 'session' ? selectedItem.pr : selectedItem.pr;
    if (pr) {
      pane.setPaneMode('diff');
      pane.setDiffFileIndex(0);
    }
    return;
  }

  // Navigate
  if (input === 'j' || key.downArrow) {
    sidebar.setSelectedIndex((i) =>
      Math.min(i + 1, sidebar.totalItems - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    sidebar.setSelectedIndex((i) => Math.max(i - 1, 0));
    return;
  }

  // Enter
  if (key.return && selectedItem) {
    // Session with running PTY → focus terminal
    if (
      selectedItem.kind === 'session' &&
      sidebar.sessionNameForTerminal &&
      hasSession(sidebar.sessionNameForTerminal)
    ) {
      pane.setPaneMode('terminal');
      pane.setReconnectKey((k) => k + 1);
      ctx.nav.setFocus('terminal');
      return;
    }

    // Session with no PTY, no PR → auto-start session
    if (selectedItem.kind === 'session' && !selectedItem.pr) {
      ctx.asyncOps.run('start-session', async () => {
        const worktrees = await listWorktrees();
        const wt = worktrees.find(
          (w) =>
            branchToSessionName(w.branch) === selectedItem.session.name
        );
        if (!wt) return;
        startAiSession(
          selectedItem.session.name,
          ctx.terminal.paneCols,
          ctx.terminal.paneRows,
          wt.path,
          ctx.config.config
        );
        await ctx.sessions.refreshSessions();
        pane.setReconnectKey((k) => k + 1);
        pane.setPaneMode('terminal');
        ctx.nav.setFocus('terminal');
      });
      return;
    }

    // Item with PR → show confirm dialog
    const pr =
      selectedItem.kind === 'session' ? selectedItem.pr : selectedItem.pr;
    if (pr) {
      if (
        sidebar.sessionNameForTerminal &&
        hasSession(sidebar.sessionNameForTerminal)
      ) {
        pane.setPaneMode('terminal');
        pane.setReconnectKey((k) => k + 1);
        ctx.nav.setFocus('terminal');
      } else {
        pane.setPaneMode('confirm');
        pane.setReviewConfirm({
          pr,
          selectedOption: 0,
        });
      }
      return;
    }
  }
}
