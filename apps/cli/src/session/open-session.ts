import type { AppConfig } from '@kirby/vcs-core';
import { branchToSessionName, createWorktree } from '@kirby/worktree-manager';
import { launchSession, type LaunchRequest } from './launch-session.js';

// ── Session opening ──────────────────────────────────────────────
//
// The single place that turns "open a session for this branch" into a
// workspace plus a spawned agent. Every UI path that creates a session
// (branch picker, PR confirm dialog, plan checkout) routes through
// here, so the workspace step has exactly one home — which is what
// lets a later change put that step behind an interface (local
// worktree today, a worktree on a beam host tomorrow) without touching
// the call sites again.

export interface OpenSessionParams {
  branch: string;
  cols: number;
  rows: number;
  config: AppConfig;
  request: LaunchRequest;
}

export type OpenSessionResult =
  | { ok: true; name: string; cwd: string }
  | { ok: false; error: string };

/**
 * Ensure the branch has a workspace, then launch the configured agent
 * in it. The session name is derived from the branch the same way the
 * sidebar derives it, so the caller can select the new row by name.
 */
export async function openSession(
  params: OpenSessionParams
): Promise<OpenSessionResult> {
  const name = branchToSessionName(params.branch);
  const cwd = await createWorktree(params.branch);
  if (!cwd) {
    return {
      ok: false,
      error: `Failed to create worktree for ${params.branch}`,
    };
  }
  launchSession({
    name,
    cwd,
    cols: params.cols,
    rows: params.rows,
    config: params.config,
    request: params.request,
  });
  return { ok: true, name, cwd };
}
