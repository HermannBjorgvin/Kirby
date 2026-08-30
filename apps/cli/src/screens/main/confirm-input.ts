import {
  handleTextInput,
  type KeyPress,
  hasSession,
  launchSession,
  getPrFromItem,
  buildReviewLaunchRequest,
} from '@kirby/core';
import { createWorktree } from '@kirby/worktree-manager';
import type { ConfirmHandlerCtx } from './input-types.js';
import { startAiSession } from './branch-picker-input.js';

async function startReviewSession(
  ctx: ConfirmHandlerCtx,
  additionalInstruction?: string
): Promise<void> {
  if (!ctx.sessionNameForTerminal || !ctx.selectedItem) return;
  const pr = getPrFromItem(ctx.selectedItem);
  if (!pr) return;

  const request = buildReviewLaunchRequest(pr, additionalInstruction);

  const worktreePath = await createWorktree(pr.sourceBranch);
  if (!worktreePath) {
    ctx.sessions.flashStatus(
      `Failed to create worktree for ${pr.sourceBranch}`
    );
    return;
  }

  // Resume an existing review conversation in this worktree if one
  // exists, otherwise seed a fresh session with the review prompt. The
  // prompt is delivered as argv/env by the launcher — never composed
  // into a shell string — so quotes in the PR title survive intact.
  launchSession({
    name: ctx.sessionNameForTerminal,
    cwd: worktreePath,
    cols: ctx.terminal.paneCols,
    rows: ctx.terminal.paneRows,
    config: ctx.config.config,
    request,
  });
}

const CONFIRM_OPTIONS = 4;

export function handleConfirmInput(
  input: string,
  key: KeyPress,
  ctx: ConfirmHandlerCtx
): void {
  const confirm = ctx.pane.reviewConfirm!;
  const opt = confirm.selectedOption;

  const action = ctx.keybinds.resolve(input, key, 'confirm');

  if (action === 'confirm.cancel') {
    ctx.pane.setReviewConfirm(null);
    ctx.pane.setReviewInstruction('');
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  // Option 2: Add instructions (text input mode)
  // Try nav actions first, then fall through to text input
  if (opt === 2) {
    if (key.return) {
      void ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.sessionNameForTerminal!)) {
          await startReviewSession(
            ctx,
            ctx.pane.reviewInstruction || undefined
          );
        }
        await ctx.sessions.refreshSessions();
        if (ctx.selectedItem?.kind !== 'review-pr') {
          ctx.sidebar.selectByKey(`session:${ctx.sessionNameForTerminal!}`);
        }
        ctx.pane.setPaneMode('terminal');
        ctx.nav.setFocus('terminal');
        ctx.pane.setReconnectKey((k) => k + 1);
        ctx.pane.setReviewConfirm(null);
        ctx.pane.setReviewInstruction('');
      });
      return;
    }
    if (action === 'confirm.navigate-up') {
      ctx.pane.setReviewConfirm({ ...confirm, selectedOption: 1 });
      return;
    }
    if (action === 'confirm.navigate-down') {
      ctx.pane.setReviewConfirm({ ...confirm, selectedOption: 3 });
      return;
    }
    handleTextInput(input, key, ctx.pane.setReviewInstruction);
    return;
  }

  if (action === 'confirm.navigate-down') {
    ctx.pane.setReviewConfirm({
      ...confirm,
      selectedOption: Math.min(opt + 1, CONFIRM_OPTIONS - 1),
    });
    return;
  }
  if (action === 'confirm.navigate-up') {
    ctx.pane.setReviewConfirm({
      ...confirm,
      selectedOption: Math.max(opt - 1, 0),
    });
    return;
  }

  if (action === 'confirm.select') {
    // Option 0: Start session (plain AI session)
    if (opt === 0) {
      void ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.sessionNameForTerminal!)) {
          const pr = ctx.selectedItem
            ? getPrFromItem(ctx.selectedItem)
            : undefined;
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
        await ctx.sessions.refreshSessions();
        if (ctx.selectedItem?.kind !== 'review-pr') {
          ctx.sidebar.selectByKey(`session:${ctx.sessionNameForTerminal!}`);
        }
        ctx.pane.setPaneMode('terminal');
        ctx.nav.setFocus('terminal');
        ctx.pane.setReconnectKey((k) => k + 1);
        ctx.pane.setReviewConfirm(null);
      });
    }
    // Option 1: Start review
    else if (opt === 1) {
      void ctx.asyncOps.run('start-session', async () => {
        if (!hasSession(ctx.sessionNameForTerminal!)) {
          await startReviewSession(ctx);
        }
        await ctx.sessions.refreshSessions();
        if (ctx.selectedItem?.kind !== 'review-pr') {
          ctx.sidebar.selectByKey(`session:${ctx.sessionNameForTerminal!}`);
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
