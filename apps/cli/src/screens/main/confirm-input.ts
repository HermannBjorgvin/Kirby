import type { Key } from 'ink';
import { createWorktree } from '@kirby/worktree-manager';
import { spawnSession, hasSession } from '../../pty-registry.js';
import { getPrFromItem } from '../../types.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { ConfirmHandlerCtx } from './input-types.js';
import { startAiSession } from './branch-picker-input.js';
import { ACTIONS, resolveAction } from '../../keybindings/index.js';

async function startReviewSession(
  ctx: ConfirmHandlerCtx,
  additionalInstruction?: string
): Promise<void> {
  if (!ctx.sessionNameForTerminal || !ctx.selectedItem) return;
  const pr = getPrFromItem(ctx.selectedItem);
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

const CONFIRM_OPTIONS = 4;

export function handleConfirmInput(
  input: string,
  key: Key,
  ctx: ConfirmHandlerCtx
): void {
  const confirm = ctx.pane.reviewConfirm!;
  const opt = confirm.selectedOption;

  const action = resolveAction(
    input,
    key,
    'confirm',
    ctx.keybinds.bindings,
    ACTIONS
  );

  if (action === 'confirm.cancel') {
    ctx.pane.setReviewConfirm(null);
    ctx.pane.setReviewInstruction('');
    ctx.pane.setPaneMode('pr-detail');
    return;
  }

  // Option 2: Add instructions (text input mode — exempt from resolution)
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
          const idx = ctx.sessions.findSortedIndex(
            updated,
            ctx.sessionNameForTerminal!
          );
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
      ctx.asyncOps.run('start-session', async () => {
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
        const updated = await ctx.sessions.refreshSessions();
        if (ctx.selectedItem?.kind !== 'review-pr') {
          const idx = ctx.sessions.findSortedIndex(
            updated,
            ctx.sessionNameForTerminal!
          );
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
          const idx = ctx.sessions.findSortedIndex(
            updated,
            ctx.sessionNameForTerminal!
          );
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
