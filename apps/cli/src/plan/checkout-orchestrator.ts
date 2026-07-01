import type { PullRequestInfo } from '@kirby/vcs-core';
import { branchToSessionName, createWorktree } from '@kirby/worktree-manager';
import { getSession, hasSession, spawnSession } from '../pty-registry.js';

// ── Checkout orchestration ───────────────────────────────────────
//
// Forwards a composed plan prompt to a Claude agent in the PR's own
// worktree. Three states (always one agent per worktree):
//
//   A. Agent already running → inject (pty.write, non-destructive) OR
//      new-session (kill old + respawn), per `mode`.
//   B. Worktree exists, no agent → spawn seeded with the plan.
//   C. No worktree → create it, then spawn seeded with the plan.
//
// States B and C are unified because `createWorktree` is idempotent —
// it returns the existing path in B and creates one in C.

export type CheckoutResult = 'injected' | 'spawned' | 'failed';

export interface CheckoutDeps {
  pr: PullRequestInfo;
  /** Composed plan prompt (see composePlanPrompt). */
  prompt: string;
  paneCols: number;
  paneRows: number;
  /** Only meaningful in State A (a running agent is present). */
  mode: 'inject' | 'new-session';
  flashStatus: (msg: string) => void;
}

/**
 * Build the shell command that spawns a fresh Claude seeded with the
 * plan. We deliberately do NOT use `claude --continue` here: continuing
 * a prior conversation would swallow the seed prompt, and the whole
 * point of checkout is to deliver the plan. Single-quote the sanitized
 * prompt as one argv entry to `/bin/sh -c`.
 */
function seedCommand(prompt: string): string {
  const safePrompt = prompt.replace(/['"]/g, '');
  return `claude '${safePrompt}'`;
}

export async function checkoutPlan(deps: CheckoutDeps): Promise<CheckoutResult> {
  const { pr, prompt, paneCols, paneRows, mode, flashStatus } = deps;
  const name = branchToSessionName(pr.sourceBranch);

  // ── State A: an agent is already running in this worktree ──
  if (hasSession(name)) {
    if (mode === 'inject') {
      const entry = getSession(name);
      if (!entry || entry.exited) {
        flashStatus('Agent is no longer running');
        return 'failed';
      }
      // Write directly into the running REPL. No shell-quoting — this
      // is typed input, and the trailing CR submits it.
      entry.pty.write(prompt + '\r');
      return 'injected';
    }
    // new-session: reseed. spawnSession kills the same-name PTY first.
    const worktreePath = await createWorktree(pr.sourceBranch);
    if (!worktreePath) {
      flashStatus(`Failed to resolve worktree for ${pr.sourceBranch}`);
      return 'failed';
    }
    spawnSession(
      name,
      '/bin/sh',
      ['-c', seedCommand(prompt)],
      paneCols,
      paneRows,
      worktreePath
    );
    return 'spawned';
  }

  // ── States B & C: no running agent — ensure a worktree, then spawn ──
  const worktreePath = await createWorktree(pr.sourceBranch);
  if (!worktreePath) {
    flashStatus(`Failed to create worktree for ${pr.sourceBranch}`);
    return 'failed';
  }
  spawnSession(
    name,
    '/bin/sh',
    ['-c', seedCommand(prompt)],
    paneCols,
    paneRows,
    worktreePath
  );
  return 'spawned';
}
