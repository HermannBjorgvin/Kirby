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
    const idA = sessionPrMap.get(a.name)?.id ?? -Infinity;
    const idB = sessionPrMap.get(b.name)?.id ?? -Infinity;
    return idB - idA;
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
