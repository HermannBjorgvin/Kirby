import { resolve } from 'node:path';
import type { Key } from 'ink';
import {
  hasSession,
  killSession,
  createSession,
  createWorktree,
  canRemoveBranch,
  listBranches,
  listAllBranches,
  listWorktrees,
  fetchRemote,
  branchToSessionName,
  rebaseOntoMaster,
} from '@kirby/tmux-manager';
import type { TmuxSession } from '@kirby/tmux-manager';
import {
  readConfig,
  readGlobalConfig,
  writeGlobalConfig,
  readProjectConfig,
  writeProjectConfig,
  autoDetectProjectConfig,
} from '@kirby/azure-devops';
import type {
  Config,
  ProjectConfig,
  GlobalConfig,
  PullRequestInfo,
  ActiveTab,
} from '@kirby/shared-types';
import { SETTINGS_FIELDS } from './components/SettingsPanel.js';

const GLOBAL_CONFIG_KEYS = new Set<keyof Config>([
  'pat',
  'prPollInterval',
  'aiCommand',
]);

/** Persist a single config field to the correct config file (global or project) */
function persistConfigField(
  key: keyof Config,
  value: string | undefined
): void {
  if (GLOBAL_CONFIG_KEYS.has(key)) {
    const g = readGlobalConfig();
    writeGlobalConfig({ ...g, [key]: value } as GlobalConfig);
  } else {
    const p = readProjectConfig();
    writeProjectConfig({ ...p, [key]: value } as ProjectConfig);
  }
}

export interface AppContext {
  // State
  config: Config;
  branches: string[];
  branchFilter: string;
  branchIndex: number;
  paneCols: number;
  paneRows: number;
  confirmDelete: { branch: string; sessionName: string; reason: string } | null;
  confirmInput: string;
  editingField: string | null;
  settingsFieldIndex: number;
  editBuffer: string;
  activeTab: ActiveTab;
  focus: 'sidebar' | 'terminal';
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
  setConfig: (v: Config | ((prev: Config) => Config)) => void;
  setFocus: (
    v:
      | 'sidebar'
      | 'terminal'
      | ((prev: 'sidebar' | 'terminal') => 'sidebar' | 'terminal')
  ) => void;
  setReconnectKey: (v: (prev: number) => number) => void;
  setBranches: (v: string[]) => void;
  flashStatus: (msg: string) => void;
  refreshSessions: () => TmuxSession[];
  refreshPr: () => void;
  performDelete: (sessionName: string, branch: string) => void;
  sendInput: (input: string, key: Key) => void;
  exit: () => void;
}

const DEFAULT_AI_COMMAND = 'claude --continue || claude';

function startAiSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
  config: Config
) {
  const cmd = config.aiCommand || DEFAULT_AI_COMMAND;
  createSession(name, cols, rows, cmd, cwd);
}

function startReviewSession(
  ctx: AppContext,
  additionalInstruction?: string
): void {
  if (!ctx.reviewSessionName || !ctx.selectedReviewPr) return;
  const pr = ctx.selectedReviewPr;
  const org = ctx.config.org ?? '';
  const project = ctx.config.project ?? '';
  const repo = ctx.config.repo ?? '';

  let prompt =
    `You are reviewing Azure DevOps Pull Request #${pr.pullRequestId} ` +
    `titled ${pr.title || pr.sourceBranch} ` +
    `in the ${org}/${project}/${repo} repository. ` +
    `The PR merges ${pr.sourceBranch} into ${pr.targetBranch}, ` +
    `authored by ${pr.createdByDisplayName ?? 'unknown'}. ` +
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

  // Checkout the PR's source branch so Claude can see the code
  const worktreePath = createWorktree(pr.sourceBranch);
  if (!worktreePath) {
    ctx.flashStatus(`Failed to create worktree for ${pr.sourceBranch}`);
    return;
  }

  // Strip quotes for shell safety — createSession wraps the command in double quotes
  const safePrompt = prompt.replace(/['"]/g, '');
  const command = `claude --continue || claude '${safePrompt}'`;

  createSession(
    ctx.reviewSessionName,
    ctx.paneCols,
    ctx.paneRows,
    command,
    worktreePath
  );
  ctx.setReviewSessionStarted((prev) => new Set([...prev, pr.pullRequestId]));
}

const REVIEW_CONFIRM_OPTIONS = 3; // 0: Start, 1: Instructions, 2: Cancel

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

  // Option 1 (instructions) captures text input when selected
  if (opt === 1) {
    if (key.return) {
      // Enter on the instruction field starts the review with the instruction
      if (!hasSession(ctx.reviewSessionName!)) {
        startReviewSession(ctx, ctx.reviewInstruction || undefined);
      }
      ctx.setFocus('terminal');
      ctx.setReviewReconnectKey((k) => k + 1);
      ctx.setReviewConfirm(null);
      ctx.setReviewInstruction('');
      return;
    }
    if (key.backspace || key.delete) {
      ctx.setReviewInstruction((v) => v.slice(0, -1));
      return;
    }
    // Arrow keys navigate away from the text field
    if (key.upArrow || (input === 'k' && key.ctrl)) {
      ctx.setReviewConfirm({ ...confirm, selectedOption: 0 });
      return;
    }
    if (key.downArrow || (input === 'j' && key.ctrl)) {
      ctx.setReviewConfirm({ ...confirm, selectedOption: 2 });
      return;
    }
    // All other input goes into the text field
    if (input && !key.ctrl && !key.meta) {
      ctx.setReviewInstruction((v) => v + input);
    }
    return;
  }

  // Options 0 and 2: navigate with arrows/j/k, Enter to select
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
      // Start review
      if (!hasSession(ctx.reviewSessionName!)) startReviewSession(ctx);
      ctx.setFocus('terminal');
      ctx.setReviewReconnectKey((k) => k + 1);
      ctx.setReviewConfirm(null);
    } else if (opt === 2) {
      // Cancel
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

  // Ctrl+f to fetch remotes and refresh branch list
  if (key.ctrl && input === 'f') {
    ctx.flashStatus('Fetching remotes...');
    fetchRemote();
    ctx.setBranches(listAllBranches());
    ctx.setBranchIndex(0);
    ctx.flashStatus('Fetched remotes');
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
      const worktreePath = createWorktree(branch);
      if (worktreePath) {
        const sessionName = branchToSessionName(branch);
        startAiSession(
          sessionName,
          ctx.paneCols,
          ctx.paneRows,
          worktreePath,
          ctx.config
        );
        const updated = ctx.refreshSessions();
        const idx = updated.findIndex((s) => s.name === sessionName);
        if (idx >= 0) ctx.setSelectedIndex(idx);
      }
    }
    ctx.setCreating(false);
    ctx.setBranchFilter('');
    ctx.setBranchIndex(0);
    return;
  }

  if (key.backspace || key.delete) {
    ctx.setBranchFilter((f) => f.slice(0, -1));
    ctx.setBranchIndex(0);
    return;
  }
  if (input && !key.ctrl && !key.meta) {
    ctx.setBranchFilter((f) => f + input);
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
      ctx.performDelete(
        ctx.confirmDelete!.sessionName,
        ctx.confirmDelete!.branch
      );
    } else {
      ctx.flashStatus('Branch name did not match — delete cancelled');
    }
    ctx.setConfirmDelete(null);
    ctx.setConfirmInput('');
    return;
  }
  if (key.backspace || key.delete) {
    ctx.setConfirmInput((v) => v.slice(0, -1));
    return;
  }
  if (input && !key.ctrl && !key.meta) {
    ctx.setConfirmInput((v) => v + input);
  }
}

export function handleSettingsInput(
  input: string,
  key: Key,
  ctx: AppContext
): void {
  if (ctx.editingField) {
    if (key.escape) {
      ctx.setEditingField(null);
      ctx.setEditBuffer('');
      return;
    }
    if (key.return) {
      const field = SETTINGS_FIELDS[ctx.settingsFieldIndex]!;
      const value = ctx.editBuffer || undefined;
      ctx.setConfig({ ...ctx.config, [field.key]: value });
      persistConfigField(field.key, value);

      ctx.setEditingField(null);
      ctx.setEditBuffer('');
      return;
    }
    if (key.backspace || key.delete) {
      ctx.setEditBuffer((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      ctx.setEditBuffer((v) => v + input);
    }
    return;
  }

  if (key.escape) {
    ctx.setSettingsOpen(false);
    return;
  }
  if (input === 'j' || key.downArrow) {
    ctx.setSettingsFieldIndex((i) =>
      Math.min(i + 1, SETTINGS_FIELDS.length - 1)
    );
    return;
  }
  if (input === 'k' || key.upArrow) {
    ctx.setSettingsFieldIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (key.leftArrow || key.rightArrow) {
    const field = SETTINGS_FIELDS[ctx.settingsFieldIndex]!;
    if (field.presets) {
      const namedPresets = field.presets.filter((p) => p.value !== null);
      const currentValue = ctx.config[field.key] as string | undefined;
      const effectiveValue = currentValue || namedPresets[0]!.value;
      let idx = namedPresets.findIndex((p) => p.value === effectiveValue);
      if (idx === -1) idx = 0;
      if (key.rightArrow) {
        idx = (idx + 1) % namedPresets.length;
      } else {
        idx = (idx - 1 + namedPresets.length) % namedPresets.length;
      }
      const preset = namedPresets[idx]!;
      ctx.setConfig({ ...ctx.config, [field.key]: preset.value });
      persistConfigField(field.key, preset.value ?? undefined);
    }
    return;
  }
  if (key.return) {
    const field = SETTINGS_FIELDS[ctx.settingsFieldIndex]!;
    ctx.setEditingField(field.key);
    ctx.setEditBuffer(String(ctx.config[field.key] ?? ''));
    return;
  }
  if (input === 'a') {
    const { updated, detected } = autoDetectProjectConfig();
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
    ctx.setBranches(listAllBranches());
    ctx.setCreating(true);
    ctx.setBranchFilter('');
    ctx.setBranchIndex(0);
    return;
  }
  if (input === 'd' && ctx.selectedSession) {
    const sessionName = ctx.selectedSession.name;
    const currentBranches = listBranches();
    const branch = currentBranches.find(
      (b) => branchToSessionName(b) === sessionName
    );
    if (branch) {
      const check = canRemoveBranch(branch);
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
      ctx.performDelete(sessionName, branch);
    } else {
      killSession(sessionName);
      const updated = ctx.refreshSessions();
      if (ctx.selectedIndex >= updated.length) {
        ctx.setSelectedIndex(Math.max(0, updated.length - 1));
      }
    }
    return;
  }
  if (input === 'K' && ctx.selectedSession) {
    killSession(ctx.selectedSession.name);
    ctx.refreshSessions();
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
    const worktrees = listWorktrees();
    const wt = worktrees.find(
      (w) => branchToSessionName(w.branch) === sessionName
    );
    if (!wt) {
      ctx.flashStatus('No worktree found for selected session');
      return;
    }
    ctx.flashStatus('Updating from master...');
    const result = rebaseOntoMaster(wt.path);
    if (result === 'success') {
      ctx.flashStatus('Rebased onto master successfully');
    } else if (result === 'conflict') {
      ctx.flashStatus('Conflicts detected — rebase aborted');
    } else {
      ctx.flashStatus('Failed to fetch origin/master');
    }
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
      const worktreePath = createWorktree(pr.sourceBranch);
      if (worktreePath) {
        const sessionName = branchToSessionName(pr.sourceBranch);
        startAiSession(
          sessionName,
          ctx.paneCols,
          ctx.paneRows,
          worktreePath,
          ctx.config
        );
        const updated = ctx.refreshSessions();
        const idx = updated.findIndex((s) => s.name === sessionName);
        if (idx >= 0) ctx.setSelectedIndex(idx);
      }
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
    // If session already running, just connect
    if (hasSession(ctx.reviewSessionName)) {
      ctx.setFocus('terminal');
      ctx.setReviewReconnectKey((k) => k + 1);
      return;
    }
    // Show confirmation in right pane
    ctx.setReviewConfirm({ pr: ctx.selectedReviewPr, selectedOption: 0 });
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
  // Number keys switch tabs (only when sidebar focused)
  if (ctx.focus === 'sidebar') {
    if (input === '1' && ctx.activeTab !== 'sessions') {
      ctx.setActiveTab('sessions');
      ctx.setFocus('sidebar');
      return;
    }
    if (input === '2' && ctx.activeTab !== 'reviews') {
      ctx.setActiveTab('reviews');
      ctx.setFocus('sidebar');
      return;
    }
  }

  // Tab switches focus
  if (key.tab && ctx.activeTab === 'sessions') {
    if (
      ctx.focus === 'sidebar' &&
      ctx.selectedName &&
      !hasSession(ctx.selectedName)
    ) {
      const worktreePath = resolve(
        process.cwd(),
        '.tui/worktrees/' + ctx.selectedName
      );
      startAiSession(
        ctx.selectedName,
        ctx.paneCols,
        ctx.paneRows,
        worktreePath,
        ctx.config
      );
      ctx.refreshSessions();
      ctx.setReconnectKey((k) => k + 1);
    }
    ctx.setFocus((f) => (f === 'sidebar' ? 'terminal' : 'sidebar'));
    return;
  }
  if (key.tab && ctx.activeTab === 'reviews') {
    if (
      ctx.focus === 'sidebar' &&
      ctx.reviewSessionName &&
      ctx.selectedReviewPr
    ) {
      if (hasSession(ctx.reviewSessionName)) {
        // Session exists — connect and focus terminal
        ctx.setReviewReconnectKey((k) => k + 1);
        ctx.setFocus('terminal');
      } else {
        // No session yet — show confirmation
        ctx.setReviewConfirm({ pr: ctx.selectedReviewPr, selectedOption: 0 });
      }
    } else if (ctx.focus === 'terminal') {
      ctx.setFocus('sidebar');
    }
    return;
  }

  // Escape returns to sidebar
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
