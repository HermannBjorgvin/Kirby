import { resolve } from 'node:path';
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
import type { AgentSession, DiffFile } from './types.js';
import { spawnSession, hasSession, killSession } from './pty-registry.js';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import type { AppConfig, PullRequestInfo } from '@kirby/vcs-core';
import { handleTextInput } from './utils/handle-text-input.js';
import {
  buildSettingsFields,
  resolveValue,
} from './components/SettingsPanel.js';
import { partitionFiles } from './utils/file-classifier.js';
import type { AppStateContextValue } from './context/AppStateContext.js';
import type { SessionContextValue } from './context/SessionContext.js';
import type { ReviewContextValue } from './context/ReviewContext.js';
import type { ConfigContextValue } from './context/ConfigContext.js';

// ── Context slice types for input handlers ────────────────────────

type NavValue = AppStateContextValue['nav'];
type AsyncOpsValue = AppStateContextValue['asyncOps'];
type BranchPickerValue = AppStateContextValue['branchPicker'];
type DeleteConfirmValue = AppStateContextValue['deleteConfirm'];
type SettingsValue = AppStateContextValue['settings'];
type TerminalLayout = AppStateContextValue['terminal'];
type ReviewValue = ReviewContextValue['review'];

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

export interface SettingsHandlerCtx {
  settings: SettingsValue;
  config: ConfigContextValue;
  sessions: SessionContextValue;
}

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

export interface GlobalHandlerCtx {
  nav: NavValue;
  config: ConfigContextValue;
  sessions: SessionContextValue;
  branchPicker: BranchPickerValue;
  deleteConfirm: DeleteConfirmValue;
  settings: SettingsValue;
  review: ReviewValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  selectedName: string | null;
  selectedSession: AgentSession | undefined;
  selectedIndex: number;
  totalItems: number;
  orphanPrs: PullRequestInfo[];
  reviewSelectedIndex: number;
  reviewTotalItems: number;
  reviewSessionName: string | null;
  selectedReviewPr: PullRequestInfo | undefined;
  reconnectKey: number;
  setReconnectKey: (v: (prev: number) => number) => void;
  triggerSync: () => void;
  refreshPr: () => void;
  exit: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────

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

// ── Input handlers ────────────────────────────────────────────────

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
          const idx = updated.findIndex((s) => s.name === sessionName);
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

export function handleSettingsInput(
  input: string,
  key: Key,
  ctx: SettingsHandlerCtx
): void {
  const fields = buildSettingsFields(ctx.config.provider);

  if (ctx.settings.editingField) {
    if (key.escape) {
      ctx.settings.setEditingField(null);
      ctx.settings.setEditBuffer('');
      return;
    }
    if (key.return) {
      const field = fields[ctx.settings.settingsFieldIndex]!;
      const value = ctx.settings.editBuffer || undefined;
      ctx.config.updateField(field, value);
      ctx.settings.setEditingField(null);
      ctx.settings.setEditBuffer('');
      return;
    }
    handleTextInput(input, key, ctx.settings.setEditBuffer);
    return;
  }

  if (key.escape) {
    ctx.settings.setSettingsOpen(false);
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.settings.setSettingsFieldIndex((i) =>
      Math.min(i + 1, fields.length - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.settings.setSettingsFieldIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (key.leftArrow || key.rightArrow) {
    const field = fields[ctx.settings.settingsFieldIndex]!;
    if (field.presets) {
      const namedPresets = field.presets.filter((p) => p.value !== null);
      const currentValue = resolveValue(ctx.config.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      if (idx === -1) idx = 0;
      if (key.rightArrow) {
        idx = (idx + 1) % namedPresets.length;
      } else {
        idx = (idx - 1 + namedPresets.length) % namedPresets.length;
      }
      const preset = namedPresets[idx]!;
      ctx.config.updateField(field, preset.value ?? undefined);
    }
    return;
  }
  if (key.return) {
    const field = fields[ctx.settings.settingsFieldIndex]!;
    if (field.presets && field.presets.every((p) => p.value !== null)) {
      const namedPresets = field.presets;
      const currentValue = resolveValue(ctx.config.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      idx = (idx + 1) % namedPresets.length;
      ctx.config.updateField(field, namedPresets[idx]!.value ?? undefined);
      return;
    }
    ctx.settings.setEditingField(field.key);
    ctx.settings.setEditBuffer(resolveValue(ctx.config.config, field));
    return;
  }
  if (input === 'a') {
    const { updated, detected } = autoDetectProjectConfig(
      process.cwd(),
      ctx.config.providers
    );
    if (updated) {
      ctx.config.setConfig(readConfig());
      const fields = Object.keys(detected).join(', ');
      ctx.sessions.flashStatus(`Auto-detected: ${fields}`);
    } else {
      ctx.sessions.flashStatus(
        'Nothing new to detect (all fields already set)'
      );
    }
    return;
  }
}

export function handleSidebarInput(
  input: string,
  key: Key,
  ctx: GlobalHandlerCtx
): void {
  if (input === 'q') {
    ctx.exit();
    return;
  }
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
  if (input === 'd' && ctx.selectedSession) {
    const sessionName = ctx.selectedSession.name;
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
        const updated = await ctx.sessions.refreshSessions();
        if (ctx.selectedIndex >= updated.length) {
          ctx.sessions.setSelectedIndex(Math.max(0, updated.length - 1));
        }
      }
    });
    return;
  }
  if (input === 'K' && ctx.selectedSession) {
    ctx.asyncOps.run('delete', async () => {
      killSession(ctx.selectedSession!.name);
      await ctx.sessions.refreshSessions();
    });
    return;
  }
  if (input === 's') {
    ctx.settings.setSettingsOpen(true);
    ctx.settings.setSettingsFieldIndex(0);
    return;
  }
  if (input === 'r') {
    ctx.refreshPr();
    ctx.sessions.flashStatus('Refreshing PR data...');
    return;
  }
  if (input === 'u' && ctx.selectedSession) {
    const sessionName = ctx.selectedSession.name;
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
  if (input === '.' && ctx.selectedSession) {
    const sessionName = ctx.selectedSession.name;
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
  if (input === 'g') {
    ctx.sessions.flashStatus('Syncing with origin...');
    ctx.triggerSync();
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.sessions.setSelectedIndex((i) => Math.min(i + 1, ctx.totalItems - 1));
  }
  if (input === 'k' || key.upArrow) {
    ctx.sessions.setSelectedIndex((i) => Math.max(i - 1, 0));
  }
  if (
    key.return &&
    ctx.selectedIndex >= ctx.sessions.sessions.length &&
    ctx.orphanPrs.length > 0
  ) {
    const prIndex = ctx.selectedIndex - ctx.sessions.sessions.length;
    const pr = ctx.orphanPrs[prIndex];
    if (pr) {
      ctx.asyncOps.run('create-worktree', async () => {
        const worktreePath = await createWorktree(pr.sourceBranch);
        if (worktreePath) {
          const sessionName = branchToSessionName(pr.sourceBranch);
          startAiSession(
            sessionName,
            ctx.terminal.paneCols,
            ctx.terminal.paneRows,
            worktreePath,
            ctx.config.config
          );
          const updated = await ctx.sessions.refreshSessions();
          const idx = updated.findIndex((s) => s.name === sessionName);
          if (idx >= 0) ctx.sessions.setSelectedIndex(idx);
        }
      });
    }
  }
}

export function handleReviewsSidebarInput(
  input: string,
  key: Key,
  ctx: GlobalHandlerCtx
): void {
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

export function handleGlobalInput(
  input: string,
  key: Key,
  ctx: GlobalHandlerCtx
): void {
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

  if (key.tab && ctx.nav.activeTab === 'sessions') {
    if (ctx.nav.focus === 'sidebar' && ctx.selectedName) {
      ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.selectedName!)) {
          const worktreePath = resolve(
            process.cwd(),
            '.claude/worktrees/' + ctx.selectedName
          );
          startAiSession(
            ctx.selectedName!,
            ctx.terminal.paneCols,
            ctx.terminal.paneRows,
            worktreePath,
            ctx.config.config
          );
          await ctx.sessions.refreshSessions();
          ctx.setReconnectKey((k) => k + 1);
        }
        ctx.nav.setFocus('terminal');
      });
    } else {
      ctx.nav.setFocus((f) => (f === 'sidebar' ? 'terminal' : 'sidebar'));
    }
    return;
  }
  if (key.tab && ctx.nav.activeTab === 'reviews') {
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

  if (ctx.nav.activeTab === 'sessions') {
    handleSidebarInput(input, key, ctx);
  } else if (ctx.nav.activeTab === 'reviews') {
    handleReviewsSidebarInput(input, key, ctx);
  }
}
