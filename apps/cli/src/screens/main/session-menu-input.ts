import type { Key } from 'ink';
import { createWorktree, listWorktrees } from '@kirby/worktree-manager';
import { hasSession } from '../../pty-registry.js';
import { launchSession } from '../../session/launch-session.js';
import { buildAgentOptions } from '../../agents/agent-options.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import type { SessionMenuHandlerCtx } from './input-types.js';
import { startAiSession } from './branch-picker-input.js';
import { resolveEditorTarget } from './editor-target.js';

export type SessionMenuOptionKey =
  | 'start'
  | 'review'
  | 'instructions'
  | 'cancel';

/**
 * The rows the session menu offers, in display order. Review options
 * only exist when the item has a PR. "start" is always first — Enter
 * straight through the menu launches the default agent.
 */
export function sessionMenuOptions(hasPr: boolean): SessionMenuOptionKey[] {
  return hasPr
    ? ['start', 'review', 'instructions', 'cancel']
    : ['start', 'cancel'];
}

async function startReviewSession(
  ctx: SessionMenuHandlerCtx,
  additionalInstruction?: string
): Promise<void> {
  if (!ctx.sessionNameForTerminal) return;
  const pr = ctx.pane.sessionMenu?.pr;
  if (!pr) return;

  // Reusable how-to guidance (installed as a system prompt for agents
  // that support it, e.g. Claude; folded into the prompt otherwise).
  const guidance =
    `To add review comments, use this command:\n` +
    `  kirby util add-comment --pr=${pr.id} --file=<path> --lineStart=<n> --lineEnd=<n> --severity=<critical|major|minor|nit> --body="<comment>"\n\n` +
    `Rules:\n` +
    `- File paths are relative to the repo root\n` +
    `- lineStart/lineEnd are 1-based line numbers in the NEW version of the file\n` +
    `- Use --side=LEFT only when commenting on removed/deleted lines\n` +
    `- Severity: critical (blocks merge), major (should fix), minor (nice to fix), nit (style/preference)\n` +
    `- Comments appear live in the reviewer's diff viewer`;

  // The per-PR task prompt.
  let task =
    `Review PR #${pr.id} ("${pr.title || pr.sourceBranch}") ` +
    `merging ${pr.sourceBranch} → ${pr.targetBranch} ` +
    `by ${pr.createdByDisplayName || 'unknown'}.\n\n` +
    `Review all changed files thoroughly. Add comments for any issues found.`;

  if (additionalInstruction) {
    task +=
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
    request: {
      intent: 'continue-or-seed',
      prompt: task,
      systemGuidance: guidance,
    },
  });
}

function closeMenu(ctx: SessionMenuHandlerCtx): void {
  const hadPr = ctx.pane.sessionMenu?.pr != null;
  ctx.pane.setSessionMenu(null);
  ctx.pane.setReviewInstruction('');
  ctx.pane.setPaneMode(hadPr ? 'pr-detail' : 'terminal');
}

export function handleSessionMenuInput(
  input: string,
  key: Key,
  ctx: SessionMenuHandlerCtx
): void {
  const menu = ctx.pane.sessionMenu!;
  const options = sessionMenuOptions(menu.pr != null);
  const opt = Math.min(menu.selectedOption, options.length - 1);
  const optKey = options[opt]!;

  const action = ctx.keybinds.resolve(input, key, 'confirm');

  if (action === 'confirm.cancel') {
    closeMenu(ctx);
    return;
  }

  // Agent cycling only applies while the start row is highlighted —
  // that's where the selection is rendered. Updater form so arrow
  // presses bunched into one stdin chunk each advance one step.
  if (optKey === 'start') {
    const cycle = (step: 1 | -1) => {
      const len = buildAgentOptions(ctx.config.config).length;
      ctx.pane.setSessionMenu(
        (prev) =>
          prev && { ...prev, agentIndex: (prev.agentIndex + step + len) % len }
      );
    };
    if (action === 'confirm.cycle-agent-left') {
      cycle(-1);
      return;
    }
    if (action === 'confirm.cycle-agent-right') {
      cycle(1);
      return;
    }
  }

  // Shared start wrapper: spawn (unless the PTY already exists), then
  // refresh + move focus into the started terminal. `launch` returns
  // false to abort without focusing (e.g. no worktree resolvable).
  const runStart = (launch: () => Promise<boolean>) => {
    ctx.asyncOps.run('start-session', async () => {
      if (!ctx.sessionNameForTerminal) return;
      if (!hasSession(ctx.sessionNameForTerminal) && !(await launch())) {
        return;
      }
      await ctx.sessions.refreshSessions();
      if (ctx.selectedItem?.kind !== 'review-pr') {
        ctx.sidebar.selectByKey(`session:${ctx.sessionNameForTerminal}`);
      }
      ctx.pane.setPaneMode('terminal');
      ctx.nav.setFocus('terminal');
      ctx.pane.setReconnectKey((k) => k + 1);
      ctx.pane.setSessionMenu(null);
      ctx.pane.setReviewInstruction('');
    });
  };

  const startSelectedSession = () => {
    runStart(async () => {
      // Existing worktree first (session rows always have one, whatever
      // its directory name); PR rows without one get it created on
      // demand — the same resolution the editor shortcut uses.
      const worktreePath = ctx.selectedItem
        ? await resolveEditorTarget(ctx.selectedItem, {
            listWorktrees,
            createWorktree,
          })
        : null;
      if (!worktreePath) {
        ctx.sessions.flashStatus('No worktree found for selected session');
        return false;
      }
      const agentOptions = buildAgentOptions(ctx.config.config);
      const agentIdx = Math.min(
        Math.max(menu.agentIndex, 0),
        agentOptions.length - 1
      );
      startAiSession(
        ctx.sessionNameForTerminal!,
        ctx.terminal.paneCols,
        ctx.terminal.paneRows,
        worktreePath,
        ctx.config.config,
        agentOptions[agentIdx]!.agent
      );
      return true;
    });
  };

  const startReview = (instruction?: string) => {
    runStart(async () => {
      await startReviewSession(ctx, instruction);
      return true;
    });
  };

  // Instructions row: text input takes precedence so any printable
  // character (including j/k under the vim preset) lands in the buffer;
  // navigation still works via the non-printable arrow keys.
  if (optKey === 'instructions') {
    if (key.return) {
      startReview(ctx.pane.reviewInstruction || undefined);
      return;
    }
    if (handleTextInput(input, key, ctx.pane.setReviewInstruction)) {
      return;
    }
    if (action === 'confirm.navigate-up') {
      ctx.pane.setSessionMenu(
        (prev) => prev && { ...prev, selectedOption: opt - 1 }
      );
      return;
    }
    if (action === 'confirm.navigate-down') {
      ctx.pane.setSessionMenu(
        (prev) => prev && { ...prev, selectedOption: opt + 1 }
      );
      return;
    }
    return;
  }

  if (action === 'confirm.navigate-down') {
    ctx.pane.setSessionMenu(
      (prev) =>
        prev && {
          ...prev,
          selectedOption: Math.min(prev.selectedOption + 1, options.length - 1),
        }
    );
    return;
  }
  if (action === 'confirm.navigate-up') {
    ctx.pane.setSessionMenu(
      (prev) =>
        prev && {
          ...prev,
          selectedOption: Math.max(prev.selectedOption - 1, 0),
        }
    );
    return;
  }

  if (action === 'confirm.select') {
    if (optKey === 'start') startSelectedSession();
    else if (optKey === 'review') startReview();
    else if (optKey === 'cancel') closeMenu(ctx);
  }
}
