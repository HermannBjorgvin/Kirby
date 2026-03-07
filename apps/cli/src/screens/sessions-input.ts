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
import type { AgentSession } from '../types.js';
import { spawnSession, hasSession, killSession } from '../pty-registry.js';
import type { AppConfig, PullRequestInfo } from '@kirby/vcs-core';
import { handleTextInput } from '../utils/handle-text-input.js';
import type { AppStateContextValue } from '../context/AppStateContext.js';
import type { SessionContextValue } from '../context/SessionContext.js';
import type { ConfigContextValue } from '../context/ConfigContext.js';

// ── Context slice types ──────────────────────────────────────────

type NavValue = AppStateContextValue['nav'];
type AsyncOpsValue = AppStateContextValue['asyncOps'];
type BranchPickerValue = AppStateContextValue['branchPicker'];
type DeleteConfirmValue = AppStateContextValue['deleteConfirm'];
type SettingsValue = AppStateContextValue['settings'];
type TerminalLayout = AppStateContextValue['terminal'];

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

export interface SessionsSidebarCtx {
  nav: NavValue;
  config: ConfigContextValue;
  sessions: SessionContextValue;
  branchPicker: BranchPickerValue;
  deleteConfirm: DeleteConfirmValue;
  settings: SettingsValue;
  asyncOps: AsyncOpsValue;
  terminal: TerminalLayout;
  selectedName: string | null;
  selectedSession: AgentSession | undefined;
  selectedIndex: number;
  totalItems: number;
  orphanPrs: PullRequestInfo[];
  reconnectKey: number;
  setReconnectKey: (v: (prev: number) => number) => void;
  triggerSync: () => void;
  refreshPr: () => void;
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

// ── Input handlers ───────────────────────────────────────────────

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

export function handleSessionsSidebarInput(
  input: string,
  key: Key,
  ctx: SessionsSidebarCtx
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

  // Sidebar actions
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
