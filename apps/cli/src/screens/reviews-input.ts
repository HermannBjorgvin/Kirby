import type { Key } from 'ink';
import { createWorktree } from '@kirby/worktree-manager';
import type { DiffFile } from '../types.js';
import { spawnSession, hasSession } from '../pty-registry.js';
import type { PullRequestInfo } from '@kirby/vcs-core';
import { handleTextInput } from '../utils/handle-text-input.js';
import { partitionFiles } from '../utils/file-classifier.js';
import type { AppStateContextValue } from '../context/AppStateContext.js';
import type { SessionContextValue } from '../context/SessionContext.js';
import type { ReviewContextValue } from '../context/ReviewContext.js';
import type { ConfigContextValue } from '../context/ConfigContext.js';

// ── Context slice types ──────────────────────────────────────────

type NavValue = AppStateContextValue['nav'];
type AsyncOpsValue = AppStateContextValue['asyncOps'];
type SettingsValue = AppStateContextValue['settings'];
type TerminalLayout = AppStateContextValue['terminal'];
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
}

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
  refreshPr: () => void;
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
    `You are reviewing Pull Request #${pr.id} ` +
    `titled ${pr.title || pr.sourceBranch}. ` +
    `The PR merges ${pr.sourceBranch} into ${pr.targetBranch}, ` +
    `authored by ${pr.createdByDisplayName || 'unknown'}. ` +
    `Review the pull request thoroughly. For each issue you find: ` +
    `1) Show the file path and line numbers, ` +
    `2) Include a relevant code snippet, ` +
    `3) Write a suggested review comment below the snippet. ` +
    `After reviewing all changes, present a numbered list of all your suggested comments ` +
    `and ask me which ones I want to post to the pull request.`;

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
    const { normal, skipped } = partitionFiles(ctx.diffFiles);
    const displayFiles = ctx.review.showSkipped
      ? [...normal, ...skipped]
      : normal;
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
  if (key.escape) {
    ctx.review.setReviewPane('diff');
    ctx.review.setDiffViewFile(null);
    return;
  }

  const viewportHeight = Math.max(1, ctx.terminal.paneRows - 3);
  const maxScroll = Math.max(0, ctx.diffTotalLines - viewportHeight);

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
  if (input === 'g') {
    ctx.review.setDiffScrollOffset(0);
    return;
  }
  if (input === 'G') {
    ctx.review.setDiffScrollOffset(maxScroll);
    return;
  }
  if (input === 'n') {
    const { normal, skipped } = partitionFiles(ctx.diffFiles);
    const displayFiles = ctx.review.showSkipped
      ? [...normal, ...skipped]
      : normal;
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
    const { normal, skipped } = partitionFiles(ctx.diffFiles);
    const displayFiles = ctx.review.showSkipped
      ? [...normal, ...skipped]
      : normal;
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
}

export function handleReviewsSidebarInput(
  input: string,
  key: Key,
  ctx: ReviewsSidebarCtx
): void {
  // Tab switching (1/2 keys)
  if (ctx.nav.focus === 'sidebar') {
    if (input === '1' && ctx.nav.activeTab !== 'sessions') {
      ctx.nav.setActiveTab('sessions');
      ctx.nav.setFocus('sidebar');
      return;
    }
    if (
      input === '2' &&
      ctx.nav.activeTab !== 'reviews' &&
      ctx.config.vcsConfigured
    ) {
      ctx.nav.setActiveTab('reviews');
      ctx.nav.setFocus('sidebar');
      return;
    }
  }

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
    ctx.refreshPr();
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
