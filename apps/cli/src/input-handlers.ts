import { resolve } from 'node:path';
import type { Key } from 'ink';
import {
  createWorktree,
  canRemoveBranch,
  listAllBranches,
  listWorktrees,
  fetchRemote,
  branchToSessionName,
  rebaseOntoMaster,
} from '@kirby/tmux-manager';
import type { TmuxSession } from '@kirby/tmux-manager';
import { spawnSession, hasSession, killSession } from './pty-registry.js';
import { readConfig, autoDetectProjectConfig } from '@kirby/vcs-core';
import type { AppConfig, VcsProvider, PullRequestInfo } from '@kirby/vcs-core';
import type { ActiveTab } from './types.js';
import { handleTextInput } from './utils/handle-text-input.js';
import {
  buildSettingsFields,
  resolveValue,
  type SettingsField,
} from './components/SettingsPanel.js';
import type { OperationName } from './hooks/useAsyncOperation.js';

export type Focus = 'sidebar' | 'terminal';

export interface AppContext {
  // State
  config: AppConfig;
  provider: VcsProvider | null;
  providers: VcsProvider[];
  vcsConfigured: boolean;
  branches: string[];
  branchFilter: string;
  branchIndex: number;
  paneCols: number;
  paneRows: number;
  confirmDelete: {
    branch: string;
    sessionName: string;
    reason: string;
  } | null;
  confirmInput: string;
  editingField: string | null;
  settingsFieldIndex: number;
  editBuffer: string;
  activeTab: ActiveTab;
  focus: Focus;
  selectedName: string | null;
  selectedSession: TmuxSession | undefined;
  selectedIndex: number;
  sessions: TmuxSession[];
  orphanPrs: PullRequestInfo[];
  totalItems: number;
  reviewSelectedIndex: number;
  reviewTotalItems: number;

  // Review terminal
  reviewSessionName: string | null;
  selectedReviewPr: PullRequestInfo | undefined;
  sendReviewInput: (input: string, key: Key) => void;
  setReviewReconnectKey: (v: (prev: number) => number) => void;
  reviewSessionStarted: Set<number>;
  setReviewSessionStarted: (
    v: Set<number> | ((prev: Set<number>) => Set<number>)
  ) => void;

  // Review confirmation
  reviewConfirm: {
    pr: PullRequestInfo;
    selectedOption: number;
  } | null;
  setReviewConfirm: (
    v: { pr: PullRequestInfo; selectedOption: number } | null
  ) => void;
  reviewInstruction: string;
  setReviewInstruction: (v: string | ((prev: string) => string)) => void;

  // Actions
  setCreating: (v: boolean) => void;
  setBranchFilter: (v: string | ((prev: string) => string)) => void;
  setBranchIndex: (v: number | ((prev: number) => number)) => void;
  setSelectedIndex: (v: number | ((prev: number) => number)) => void;
  setConfirmDelete: (
    v: { branch: string; sessionName: string; reason: string } | null
  ) => void;
  setConfirmInput: (v: string | ((prev: string) => string)) => void;
  setSettingsOpen: (v: boolean) => void;
  setSettingsFieldIndex: (v: number | ((prev: number) => number)) => void;
  setEditingField: (v: string | null) => void;
  setEditBuffer: (v: string | ((prev: string) => string)) => void;
  setActiveTab: (v: ActiveTab) => void;
  setReviewSelectedIndex: (v: number | ((prev: number) => number)) => void;
  setConfig: (v: AppConfig | ((prev: AppConfig) => AppConfig)) => void;
  setFocus: (v: Focus | ((prev: Focus) => Focus)) => void;
  setReconnectKey: (v: (prev: number) => number) => void;
  setBranches: (v: string[]) => void;
  flashStatus: (msg: string) => void;
  triggerSync: () => void;
  refreshSessions: () => Promise<TmuxSession[]>;
  refreshPr: () => void;
  performDelete: (sessionName: string, branch: string) => Promise<void>;
  sendInput: (input: string, key: Key) => void;
  exit: () => void;

  // Config
  updateField: (field: SettingsField, value: string | undefined) => void;

  // Async operations
  runOp: (name: OperationName, fn: () => Promise<void>) => Promise<void>;
  isRunning: (name: OperationName) => boolean;
}

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
  ctx: AppContext,
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
    ctx.flashStatus(`Failed to create worktree for ${pr.sourceBranch}`);
    return;
  }

  const safePrompt = prompt.replace(/['"]/g, '');
  const command = `claude --continue || claude '${safePrompt}'`;

  spawnSession(
    ctx.reviewSessionName,
    '/bin/sh',
    ['-c', command],
    ctx.paneCols,
    ctx.paneRows,
    worktreePath
  );
  ctx.setReviewSessionStarted((prev) => new Set([...prev, pr.id]));
}

const REVIEW_CONFIRM_OPTIONS = 3;

export function handleReviewConfirmInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  const confirm = ctx.reviewConfirm!;
  const opt = confirm.selectedOption;

  if (key.escape) {
    ctx.setReviewConfirm(null);
    ctx.setReviewInstruction('');
    return;
  }

  if (opt === 1) {
    if (key.return) {
      ctx.runOp('start-session', async () => {
        if (!hasSession(ctx.reviewSessionName!)) {
          await startReviewSession(ctx, ctx.reviewInstruction || undefined);
        }
        ctx.setFocus('terminal');
        ctx.setReviewReconnectKey((k) => k + 1);
        ctx.setReviewConfirm(null);
        ctx.setReviewInstruction('');
      });
      return;
    }
    if (key.upArrow || (input === 'k' && key.ctrl)) {
      ctx.setReviewConfirm({ ...confirm, selectedOption: 0 });
      return;
    }
    if (key.downArrow || (input === 'j' && key.ctrl)) {
      ctx.setReviewConfirm({ ...confirm, selectedOption: 2 });
      return;
    }
    handleTextInput(input, key, ctx.setReviewInstruction);
    return;
  }

  if (input === 'j' || key.downArrow) {
    ctx.setReviewConfirm({
      ...confirm,
      selectedOption: Math.min(opt + 1, REVIEW_CONFIRM_OPTIONS - 1),
    });
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.setReviewConfirm({
      ...confirm,
      selectedOption: Math.max(opt - 1, 0),
    });
    return;
  }

  if (key.return) {
    if (opt === 0) {
      ctx.runOp('start-session', async () => {
        if (!hasSession(ctx.reviewSessionName!)) {
          await startReviewSession(ctx);
        }
        ctx.setFocus('terminal');
        ctx.setReviewReconnectKey((k) => k + 1);
        ctx.setReviewConfirm(null);
      });
    } else if (opt === 2) {
      ctx.setReviewConfirm(null);
      ctx.setReviewInstruction('');
    }
  }
}

export function handleBranchPickerInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  if (key.escape) {
    ctx.setCreating(false);
    ctx.setBranchFilter('');
    ctx.setBranchIndex(0);
    return;
  }

  if (key.ctrl && input === 'f') {
    ctx.runOp('fetch-branches', async () => {
      ctx.flashStatus('Fetching remotes...');
      await fetchRemote();
      const allBranches = await listAllBranches();
      ctx.setBranches(allBranches);
      ctx.setBranchIndex(0);
      ctx.flashStatus('Fetched remotes');
    });
    return;
  }

  const filtered = ctx.branches.filter((b) =>
    b.toLowerCase().includes(ctx.branchFilter.toLowerCase())
  );

  if (key.upArrow) {
    ctx.setBranchIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (key.downArrow) {
    ctx.setBranchIndex((i) => Math.min(i + 1, filtered.length - 1));
    return;
  }

  if (key.return) {
    const branch =
      filtered.length > 0
        ? filtered[ctx.branchIndex]!
        : ctx.branchFilter.trim();
    if (branch) {
      ctx.runOp('create-worktree', async () => {
        const worktreePath = await createWorktree(branch);
        if (worktreePath) {
          const sessionName = branchToSessionName(branch);
          startAiSession(
            sessionName,
            ctx.paneCols,
            ctx.paneRows,
            worktreePath,
            ctx.config
          );
          const updated = await ctx.refreshSessions();
          const idx = updated.findIndex((s) => s.name === sessionName);
          if (idx >= 0) ctx.setSelectedIndex(idx);
        }
      });
    }
    ctx.setCreating(false);
    ctx.setBranchFilter('');
    ctx.setBranchIndex(0);
    return;
  }

  if (handleTextInput(input, key, ctx.setBranchFilter)) {
    ctx.setBranchIndex(0);
  }
}

export function handleConfirmDeleteInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  if (key.escape) {
    ctx.setConfirmDelete(null);
    ctx.setConfirmInput('');
    return;
  }
  if (key.return) {
    if (ctx.confirmInput === ctx.confirmDelete!.branch) {
      ctx.runOp('delete', async () => {
        await ctx.performDelete(
          ctx.confirmDelete!.sessionName,
          ctx.confirmDelete!.branch
        );
      });
    } else {
      ctx.flashStatus('Branch name did not match — delete cancelled');
    }
    ctx.setConfirmDelete(null);
    ctx.setConfirmInput('');
    return;
  }
  handleTextInput(input, key, ctx.setConfirmInput);
}

export function handleSettingsInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  const fields = buildSettingsFields(ctx.provider);

  if (ctx.editingField) {
    if (key.escape) {
      ctx.setEditingField(null);
      ctx.setEditBuffer('');
      return;
    }
    if (key.return) {
      const field = fields[ctx.settingsFieldIndex]!;
      const value = ctx.editBuffer || undefined;
      ctx.updateField(field, value);
      ctx.setEditingField(null);
      ctx.setEditBuffer('');
      return;
    }
    handleTextInput(input, key, ctx.setEditBuffer);
    return;
  }

  if (key.escape) {
    ctx.setSettingsOpen(false);
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.setSettingsFieldIndex((i) => Math.min(i + 1, fields.length - 1));
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.setSettingsFieldIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (key.leftArrow || key.rightArrow) {
    const field = fields[ctx.settingsFieldIndex]!;
    if (field.presets) {
      const namedPresets = field.presets.filter((p) => p.value !== null);
      const currentValue = resolveValue(ctx.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      if (idx === -1) idx = 0;
      if (key.rightArrow) {
        idx = (idx + 1) % namedPresets.length;
      } else {
        idx = (idx - 1 + namedPresets.length) % namedPresets.length;
      }
      const preset = namedPresets[idx]!;
      ctx.updateField(field, preset.value ?? undefined);
    }
    return;
  }
  if (key.return) {
    const field = fields[ctx.settingsFieldIndex]!;
    // Fields with only named presets (no Custom/null entry): toggle instead of edit
    if (field.presets && field.presets.every((p) => p.value !== null)) {
      const namedPresets = field.presets;
      const currentValue = resolveValue(ctx.config, field) || undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      idx = (idx + 1) % namedPresets.length;
      ctx.updateField(field, namedPresets[idx]!.value ?? undefined);
      return;
    }
    ctx.setEditingField(field.key);
    ctx.setEditBuffer(resolveValue(ctx.config, field));
    return;
  }
  if (input === 'a') {
    const { updated, detected } = autoDetectProjectConfig(
      process.cwd(),
      ctx.providers
    );
    if (updated) {
      ctx.setConfig(readConfig());
      const fields = Object.keys(detected).join(', ');
      ctx.flashStatus(`Auto-detected: ${fields}`);
    } else {
      ctx.flashStatus('Nothing new to detect (all fields already set)');
    }
    return;
  }
}

export function handleSidebarInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  if (input === 'q') {
    ctx.exit();
    return;
  }
  if (input === 'c') {
    ctx.runOp('fetch-branches', async () => {
      const allBranches = await listAllBranches();
      ctx.setBranches(allBranches);
      ctx.setCreating(true);
      ctx.setBranchFilter('');
      ctx.setBranchIndex(0);
    });
    return;
  }
  if (input === 'd' && ctx.selectedSession) {
    const sessionName = ctx.selectedSession.name;
    ctx.runOp('check-delete', async () => {
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
            ctx.setConfirmDelete({ branch, sessionName, reason: check.reason });
            ctx.setConfirmInput('');
          } else {
            ctx.flashStatus(`Cannot delete: ${check.reason}`);
          }
          return;
        }
        await ctx.performDelete(sessionName, branch);
      } else {
        killSession(sessionName);
        const updated = await ctx.refreshSessions();
        if (ctx.selectedIndex >= updated.length) {
          ctx.setSelectedIndex(Math.max(0, updated.length - 1));
        }
      }
    });
    return;
  }
  if (input === 'K' && ctx.selectedSession) {
    ctx.runOp('delete', async () => {
      killSession(ctx.selectedSession!.name);
      await ctx.refreshSessions();
    });
    return;
  }
  if (input === 's') {
    ctx.setSettingsOpen(true);
    ctx.setSettingsFieldIndex(0);
    return;
  }
  if (input === 'r') {
    ctx.refreshPr();
    ctx.flashStatus('Refreshing PR data...');
    return;
  }
  if (input === 'u' && ctx.selectedSession) {
    const sessionName = ctx.selectedSession.name;
    ctx.runOp('rebase', async () => {
      const worktrees = await listWorktrees();
      const wt = worktrees.find(
        (w) => branchToSessionName(w.branch) === sessionName
      );
      if (!wt) {
        ctx.flashStatus('No worktree found for selected session');
        return;
      }
      ctx.flashStatus('Updating from origin...');
      const rebaseMessages = {
        success: 'Rebased onto origin successfully',
        conflict: 'Conflicts detected — rebase aborted',
        error: 'Failed to fetch from origin',
      } as const;
      ctx.flashStatus(rebaseMessages[await rebaseOntoMaster(wt.path)]);
    });
    return;
  }
  if (input === 'g') {
    ctx.flashStatus('Syncing with origin...');
    ctx.triggerSync();
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.setSelectedIndex((i) => Math.min(i + 1, ctx.totalItems - 1));
  }
  if (input === 'k' || key.upArrow) {
    ctx.setSelectedIndex((i) => Math.max(i - 1, 0));
  }
  if (
    key.return &&
    ctx.selectedIndex >= ctx.sessions.length &&
    ctx.orphanPrs.length > 0
  ) {
    const prIndex = ctx.selectedIndex - ctx.sessions.length;
    const pr = ctx.orphanPrs[prIndex];
    if (pr) {
      ctx.runOp('create-worktree', async () => {
        const worktreePath = await createWorktree(pr.sourceBranch);
        if (worktreePath) {
          const sessionName = branchToSessionName(pr.sourceBranch);
          startAiSession(
            sessionName,
            ctx.paneCols,
            ctx.paneRows,
            worktreePath,
            ctx.config
          );
          const updated = await ctx.refreshSessions();
          const idx = updated.findIndex((s) => s.name === sessionName);
          if (idx >= 0) ctx.setSelectedIndex(idx);
        }
      });
    }
  }
}

export function handleReviewsSidebarInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  if (input === 'q') {
    ctx.exit();
    return;
  }
  if (input === 'r') {
    ctx.refreshPr();
    ctx.flashStatus('Refreshing PR data...');
    return;
  }
  if (input === 's') {
    ctx.setSettingsOpen(true);
    ctx.setSettingsFieldIndex(0);
    return;
  }
  if (key.return && ctx.reviewSessionName && ctx.selectedReviewPr) {
    ctx.runOp('start-session', async () => {
      if (hasSession(ctx.reviewSessionName!)) {
        ctx.setFocus('terminal');
        ctx.setReviewReconnectKey((k) => k + 1);
        return;
      }
      ctx.setReviewConfirm({ pr: ctx.selectedReviewPr!, selectedOption: 0 });
    });
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.setReviewSelectedIndex((i) =>
      Math.min(i + 1, ctx.reviewTotalItems - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.setReviewSelectedIndex((i) => Math.max(i - 1, 0));
    return;
  }
}

export function handleGlobalInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  if (ctx.focus === 'sidebar') {
    if (input === '1' && ctx.activeTab !== 'sessions') {
      ctx.setActiveTab('sessions');
      ctx.setFocus('sidebar');
      return;
    }
    if (input === '2' && ctx.activeTab !== 'reviews' && ctx.vcsConfigured) {
      ctx.setActiveTab('reviews');
      ctx.setFocus('sidebar');
      return;
    }
  }

  if (key.tab && ctx.activeTab === 'sessions') {
    if (ctx.focus === 'sidebar' && ctx.selectedName) {
      ctx.runOp('start-session', async () => {
        if (!hasSession(ctx.selectedName!)) {
          const worktreePath = resolve(
            process.cwd(),
            '.claude/worktrees/' + ctx.selectedName
          );
          startAiSession(
            ctx.selectedName!,
            ctx.paneCols,
            ctx.paneRows,
            worktreePath,
            ctx.config
          );
          await ctx.refreshSessions();
          ctx.setReconnectKey((k) => k + 1);
        }
        ctx.setFocus('terminal');
      });
    } else {
      ctx.setFocus((f) => (f === 'sidebar' ? 'terminal' : 'sidebar'));
    }
    return;
  }
  if (key.tab && ctx.activeTab === 'reviews') {
    if (
      ctx.focus === 'sidebar' &&
      ctx.reviewSessionName &&
      ctx.selectedReviewPr
    ) {
      ctx.runOp('start-session', async () => {
        if (hasSession(ctx.reviewSessionName!)) {
          ctx.setReviewReconnectKey((k) => k + 1);
          ctx.setFocus('terminal');
        } else {
          ctx.setReviewConfirm({
            pr: ctx.selectedReviewPr!,
            selectedOption: 0,
          });
        }
      });
    } else if (ctx.focus === 'terminal') {
      ctx.setFocus('sidebar');
    }
    return;
  }

  if (key.escape) {
    if (ctx.focus === 'terminal') {
      ctx.setFocus('sidebar');
      return;
    }
  }

  if (ctx.focus === 'sidebar') {
    if (ctx.activeTab === 'sessions') {
      handleSidebarInput(input, key, ctx);
    } else if (ctx.activeTab === 'reviews') {
      handleReviewsSidebarInput(input, key, ctx);
    }
  } else {
    if (ctx.activeTab === 'reviews') {
      ctx.sendReviewInput(input, key);
    } else {
      ctx.sendInput(input, key);
    }
  }
}
