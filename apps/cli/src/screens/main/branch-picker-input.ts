import type { Key } from 'ink';
import type { AppConfig } from '@kirby/vcs-core';
import { listAllBranches, fetchRemote } from '@kirby/worktree-manager';
import { launchSession } from '../../session/launch-session.js';
import { openSession } from '../../session/open-session.js';
import { availableBeamHost } from '../../session-backend.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { BranchPickerHandlerCtx } from './input-types.js';

export function startAiSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
  config: AppConfig
) {
  // Resume a prior conversation in this worktree if there is one, else
  // start blank. The configured agent decides whether continue is even
  // possible (only Claude, currently) — everyone else starts blank.
  launchSession({
    name,
    cwd,
    cols,
    rows,
    config,
    request: { intent: 'continue-or-blank' },
  });
}

/** Close the picker and open the session, locally or on a beam host. */
function openPicked(
  ctx: BranchPickerHandlerCtx,
  branch: string,
  where: string | undefined
): void {
  ctx.asyncOps.run('create-worktree', async () => {
    const result = await openSession({
      branch,
      cols: ctx.terminal.paneCols,
      rows: ctx.terminal.paneRows,
      config: ctx.config.config,
      request: { intent: 'continue-or-blank' },
      ...(where ? { where } : {}),
    });
    if (result.ok) {
      await ctx.sessions.refreshSessions();
      ctx.sidebar.selectByKey(`session:${result.name}`);
    } else {
      ctx.sessions.flashStatus(result.error);
    }
  });
  ctx.branchPicker.setCreating(false);
  ctx.branchPicker.setBranchFilter('');
  ctx.branchPicker.setBranchIndex(0);
  ctx.branchPicker.setLocationBranch(null);
  ctx.branchPicker.setLocationIndex(0);
}

export function handleBranchPickerInput(
  input: string,
  key: Key,
  ctx: BranchPickerHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'branch-picker');

  // Second stage: the branch is picked, choose where it runs.
  const locationBranch = ctx.branchPicker.locationBranch;
  if (locationBranch !== null) {
    const host = availableBeamHost(ctx.config.config);
    const optionCount = host ? 2 : 1;
    if (action === 'branch-picker.cancel') {
      // Back to the branch list, not out of the picker.
      ctx.branchPicker.setLocationBranch(null);
      ctx.branchPicker.setLocationIndex(0);
      return;
    }
    if (action === 'branch-picker.navigate-up') {
      ctx.branchPicker.setLocationIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (action === 'branch-picker.navigate-down') {
      ctx.branchPicker.setLocationIndex((i) =>
        Math.min(i + 1, optionCount - 1)
      );
      return;
    }
    if (action === 'branch-picker.select') {
      const where =
        ctx.branchPicker.locationIndex === 1 && host ? host : undefined;
      openPicked(ctx, locationBranch, where);
    }
    return;
  }

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
      // With a beam host available, ask where the session should live
      // before opening anything. Without one, open locally right away
      // — the flow is unchanged.
      if (availableBeamHost(ctx.config.config)) {
        ctx.branchPicker.setLocationBranch(branch);
        ctx.branchPicker.setLocationIndex(0);
        return;
      }
      openPicked(ctx, branch, undefined);
      return;
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
