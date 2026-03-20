import type { AgentSession } from '../types.js';
import type { PullRequestInfo } from '@kirby/vcs-core';

/**
 * Sort sessions by descending PR ID.
 * Sessions without a PR mapping sort to the end (stable).
 */
export function sortSessionsByPrId(
  sessions: AgentSession[],
  sessionPrMap: Map<string, PullRequestInfo>
): AgentSession[] {
  return [...sessions].sort((a, b) => {
    const idA = sessionPrMap.get(a.name)?.id;
    const idB = sessionPrMap.get(b.name)?.id;
    // Both have PRs: sort descending by ID
    if (idA != null && idB != null) return idB - idA;
    // Only one has a PR: it sorts first
    if (idA != null) return -1;
    if (idB != null) return 1;
    // Neither has a PR: preserve original order
    return 0;
  });
}

/**
 * Find the index of a session by name in a PR-ID-sorted list.
 *
 * Use this instead of `sessions.findIndex(s => s.name === name)` when the
 * result will be passed to `setSelectedIndex`, because the sidebar renders
 * sessions in sorted (by PR ID) order, not insertion order.
 */
export function findSortedSessionIndex(
  sessions: AgentSession[],
  sessionPrMap: Map<string, PullRequestInfo>,
  name: string
): number {
  return sortSessionsByPrId(sessions, sessionPrMap).findIndex(
    (s) => s.name === name
  );
}
