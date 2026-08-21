import type { Key } from 'ink';
import type { AppConfig } from '@kirby/vcs-core';
import {
  createWorktree,
  listAllBranches,
  fetchRemote,
  branchToSessionName,
} from '@kirby/worktree-manager';
import { launchSession } from '../../session/launch-session.js';
import { hasSession } from '../../pty-registry.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { AgentDefinition } from '../../agents/registry.js';
import { requestSessionMenu } from '../../session-menu-request.js';
import { getPrFromItem } from '../../types.js';
import type { BranchPickerHandlerCtx } from './input-types.js';

export function startAiSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
  config: AppConfig,
  agentOverride?: AgentDefinition
) {
  // Resume a prior conversation in this worktree if there is one, else
  // start blank. The launched agent decides whether continue is even
  // possible (only Claude, currently) — everyone else starts blank.
  launchSession({
    name,
    cwd,
    cols,
    rows,
    config,
    agent: agentOverride,
    request: { intent: 'continue-or-blank' },
  });
}

export function handleBranchPickerInput(
  input: string,
  key: Key,
  ctx: BranchPickerHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'branch-picker');

  if (action === 'branch-picker.cancel') {
    ctx.branchPicker.setCreating(false);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
    return;
  }

  if (action === 'branch-picker.fetch') {
    ctx.asyncOps.run('fetch-branches', async () => {
      // No "Fetching remotes…" flash — the 'fetch-branches' spinner
      // (label: "Fetching branches") already shows we're working.
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

  if (action === 'branch-picker.navigate-up') {
    ctx.branchPicker.setBranchIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (action === 'branch-picker.navigate-down') {
    ctx.branchPicker.setBranchIndex((i) =>
      Math.min(i + 1, filtered.length - 1)
    );
    return;
  }

  if (action === 'branch-picker.select') {
    const branch =
      filtered.length > 0
        ? filtered[ctx.branchPicker.branchIndex]!
        : ctx.branchPicker.branchFilter.trim();
    if (branch) {
      ctx.asyncOps.run('create-worktree', async () => {
        const worktreePath = await createWorktree(branch);
        if (worktreePath) {
          const sessionName = branchToSessionName(branch);
          await ctx.sessions.refreshSessions();

          // Picking a branch whose session is already running: there is
          // no agent left to choose, so skip the menu and jump straight
          // into the running terminal — same as Tab on its row.
          if (hasSession(sessionName)) {
            ctx.sidebar.selectByKey(`session:${sessionName}`);
            ctx.pane.setPaneMode('terminal');
            ctx.pane.setReconnectKey((k) => k + 1);
            ctx.nav.setFocus('terminal');
            return;
          }

          // Land the user in the new session's menu (agent choice,
          // start, cancel). When the selection is already on this
          // session's row, no remount will happen — open directly.
          // Otherwise the selection move remounts the pane, so the menu
          // is requested via the mailbox instead of set on state that's
          // about to be discarded.
          if (ctx.sidebar.sessionNameForTerminal === sessionName) {
            ctx.pane.setPaneMode('confirm');
            ctx.pane.setSessionMenu({
              pr: ctx.sidebar.selectedItem
                ? getPrFromItem(ctx.sidebar.selectedItem) ?? null
                : null,
              selectedOption: 0,
              agentIndex: 0,
            });
            return;
          }

          requestSessionMenu(sessionName);
          ctx.sidebar.selectByKey(`session:${sessionName}`);
        }
      });
    }
    ctx.branchPicker.setCreating(false);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
    return;
  }

  // Text input for branch filter (exempt from resolution)
  if (handleTextInput(input, key, ctx.branchPicker.setBranchFilter)) {
    ctx.branchPicker.setBranchIndex(0);
  }
}
