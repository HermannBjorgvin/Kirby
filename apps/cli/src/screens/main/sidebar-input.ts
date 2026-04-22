import { spawn } from 'node:child_process';
import type { Key } from 'ink';
import {
  canRemoveBranch,
  listAllBranches,
  listWorktrees,
  branchToSessionName,
  rebaseOntoMaster,
} from '@kirby/worktree-manager';
import { hasSession, killSession } from '../../pty-registry.js';
import { getPrFromItem } from '../../types.js';
import type { SidebarInputCtx } from './input-types.js';
import { startAiSession } from './branch-picker-input.js';

export function handleSidebarInput(
  input: string,
  key: Key,
  ctx: SidebarInputCtx
): void {
  const { sidebar, pane } = ctx;
  const selectedItem = sidebar.selectedItem;

  const action = ctx.keybinds.resolve(input, key, 'sidebar');

  // Toggle hint visibility
  if (action === 'sidebar.toggle-hints') {
    ctx.toggleHints();
    return;
  }

  // Tab focus toggle
  if (action === 'sidebar.focus-terminal') {
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
            (w) => branchToSessionName(w.branch) === selectedItem.session.name
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
  if (action === 'sidebar.quit') {
    ctx.exit();
    return;
  }

  // Create/checkout branch
  if (action === 'sidebar.checkout-branch') {
    ctx.asyncOps.run('fetch-branches', async () => {
      const allBranches = await listAllBranches();
      ctx.branchPicker.setBranches(allBranches);
      ctx.branchPicker.setCreating(true);
      ctx.branchPicker.setBranchFilter('');
      ctx.branchPicker.setBranchIndex(0);
    });
    return;
  }

  // Delete branch
  if (
    action === 'sidebar.delete-branch' &&
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
        await ctx.sessions.refreshSessions();
      }
    });
    return;
  }

  // Kill agent
  if (
    action === 'sidebar.kill-agent' &&
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
  if (action === 'sidebar.open-settings') {
    ctx.settings.setSettingsOpen(true);
    ctx.settings.setSettingsFieldIndex(0);
    return;
  }

  // Refresh PR data — loading state shown by the top-right spinner.
  if (action === 'sidebar.refresh-pr') {
    ctx.asyncOps.run('refresh-pr', async () => {
      await ctx.sessions.refreshPr();
    });
    return;
  }

  // Rebase onto master
  if (action === 'sidebar.rebase' && selectedItem?.kind === 'session') {
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
      // No "Updating from origin…" flash — the 'rebase' spinner
      // (label: "Rebasing") already communicates that we're working.
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
  if (action === 'sidebar.open-editor' && selectedItem?.kind === 'session') {
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
        ctx.sessions.flashStatus('No editor configured — set one in settings');
        return;
      }
      spawn(editor, [wt.path], { detached: true, stdio: 'ignore' }).unref();
      ctx.sessions.flashStatus(`Opened in ${editor}`);
    });
    return;
  }

  // Sync with origin — loading state shown by the top-right spinner.
  if (action === 'sidebar.sync-origin') {
    ctx.asyncOps.run('sync', async () => {
      await ctx.sessions.triggerSync();
    });
    return;
  }

  // View diff
  if (action === 'sidebar.view-diff' && selectedItem) {
    const pr = getPrFromItem(selectedItem);
    if (pr) {
      pane.setPaneMode('diff');
      pane.setDiffFileIndex(0);
    }
    return;
  }

  // Navigate
  if (action === 'sidebar.navigate-down') {
    sidebar.moveSelection(1);
    return;
  }
  if (action === 'sidebar.navigate-up') {
    sidebar.moveSelection(-1);
    return;
  }
  if (action === 'sidebar.jump-next-active') {
    sidebar.moveSelectionToActive(1);
    return;
  }
  if (action === 'sidebar.jump-prev-active') {
    sidebar.moveSelectionToActive(-1);
    return;
  }

  // Enter
  if (action === 'sidebar.start-session' && selectedItem) {
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
          (w) => branchToSessionName(w.branch) === selectedItem.session.name
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
    const pr = getPrFromItem(selectedItem);
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
