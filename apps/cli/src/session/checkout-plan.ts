import type { AppConfig, PullRequestInfo } from '@kirby/vcs-core';
import { branchToSessionName } from '@kirby/worktree-manager';
import { hasSession } from '../pty-registry.js';
import { deliverToRunningSession } from './launch-session.js';
import { openSession } from './open-session.js';

// ── Checkout orchestration ───────────────────────────────────────
//
// Forwards a composed plan prompt to the configured agent in the PR's
// own worktree. Three states (always one agent per worktree):
//
//   A. Agent already running → inject (typed into the REPL,
//      non-destructive) OR new-session (kill old + respawn), per `mode`.
//   B. Worktree exists, no agent → spawn seeded with the plan.
//   C. No worktree → create it, then spawn seeded with the plan.
//
// States B and C are unified because `createWorktree` is idempotent —
// it returns the existing path in B and creates one in C.
//
// The spawn uses the `seed` intent, never `continue`: continuing a prior
// conversation would swallow the plan, and delivering the plan is the
// whole point of checkout. The launcher hands the prompt to the agent as
// argv (or env), so no shell quoting is involved.

export type CheckoutResult = 'injected' | 'spawned' | 'failed';

export interface CheckoutDeps {
  pr: PullRequestInfo;
  /** Composed plan prompt (see composePlanPrompt). */
  prompt: string;
  paneCols: number;
  paneRows: number;
  /** Only meaningful in State A (a running agent is present). */
  mode: 'inject' | 'new-session';
  /** Drives which agent is launched. */
  config: AppConfig;
  flashStatus: (msg: string) => void;
}

export async function checkoutPlan(
  deps: CheckoutDeps
): Promise<CheckoutResult> {
  const { pr, prompt, paneCols, paneRows, mode, config, flashStatus } = deps;
  const name = branchToSessionName(pr.sourceBranch);

  const seed = () =>
    openSession({
      branch: pr.sourceBranch,
      cols: paneCols,
      rows: paneRows,
      config,
      request: { intent: 'seed', prompt },
    });

  // ── State A: an agent is already running in this worktree ──
  if (hasSession(name)) {
    if (mode === 'inject') {
      if (!deliverToRunningSession(name, prompt)) {
        flashStatus('Agent is no longer running');
        return 'failed';
      }
      return 'injected';
    }
    // new-session: reseed. The spawn kills the same-name PTY first.
    const reseeded = await seed();
    if (!reseeded.ok) {
      flashStatus(reseeded.error);
      return 'failed';
    }
    return 'spawned';
  }

  // ── States B & C: no running agent — ensure a worktree, then spawn ──
  const opened = await seed();
  if (!opened.ok) {
    flashStatus(opened.error);
    return 'failed';
  }
  return 'spawned';
}
