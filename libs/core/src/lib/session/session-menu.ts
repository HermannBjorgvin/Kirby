import type { PullRequestInfo } from '@n10/vcs-core';

// ── Session menu model ───────────────────────────────────────────
//
// The menu every shell shows when the user activates a sidebar row
// whose agent is not running: start (or continue) a session with an
// agent chosen for this launch, or — for rows backed by a pull request
// — start an AI review, optionally with extra instructions.
//
// Pure data: the TUI and the desktop each render it their own way and
// drive it through their own input handling.

export type SessionMenuOptionKey =
  | 'start'
  | 'review'
  | 'instructions'
  | 'cancel';

export interface SessionMenuState {
  /** The pull request behind the row, when there is one. */
  pr: PullRequestInfo | null;
  /** Highlighted row, an index into {@link sessionMenuOptions}. */
  selectedOption: number;
  /**
   * 0 opens/resumes the recorded agent, falling back to the configured
   * default for a new session. Positive values select a fresh launch with
   * `buildAgentOptions(config)[agentIndex - 1]`, including the default.
   */
  agentIndex: number;
}

/**
 * The rows the session menu offers, in display order. Review options
 * only exist when the item has a PR. "start" is always first — Enter
 * opens the recorded agent or uses the default for a new session.
 */
export function sessionMenuOptions(hasPr: boolean): SessionMenuOptionKey[] {
  return hasPr
    ? ['start', 'review', 'instructions', 'cancel']
    : ['start', 'cancel'];
}

/** A fresh menu for a row: first option, automatic agent selection. */
export function openSessionMenuState(
  pr: PullRequestInfo | null | undefined
): SessionMenuState {
  return { pr: pr ?? null, selectedOption: 0, agentIndex: 0 };
}

/** Wrap-around step through `count` agents. */
export function cycleAgentIndex(
  current: number,
  step: 1 | -1,
  count: number
): number {
  if (count <= 0) return 0;
  return (current + step + count) % count;
}
