import type { BabysitStatus } from '../../../host/contract.js';

export interface BabysitBadge {
  label: string;
  title: string;
  tone: 'info' | 'warning';
}

function relative(ms: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ago`;
}

/**
 * The badge a babysat pull request's row wears. Its label is the
 * phase; its title says what the babysitter has done and whether the
 * last poll went wrong, which is the one thing the user cannot
 * otherwise see — a watcher that has quietly stopped reaching the
 * provider looks exactly like one with nothing to report.
 */
const HELD: Record<NonNullable<BabysitStatus['held']>, string> = {
  'agent-busy': 'held until the agent has been quiet for a while',
  'no-agent':
    'held until you start an agent on it — Kirby does not start one on ' +
    'a pull request that is not yours',
  'foreign-session':
    'held: a session under this branch name belongs to another repository',
  'branch-unavailable':
    'held: the branch is not available locally or on origin, so no ' +
    'worktree can be made for an agent',
};

export function babysitBadge(
  status: BabysitStatus,
  now = Date.now()
): BabysitBadge {
  const lines: string[] = [];
  if (status.phase === 'pending' && status.pendingSince !== null) {
    const held = status.held ? HELD[status.held] : 'sent once quiet';
    lines.push(
      `Update waiting since ${relative(status.pendingSince, now)}; ${held}`
    );
  } else {
    lines.push('Watching CI, review threads and conflicts');
  }
  if (status.deliveries > 0 && status.lastDeliveredAt !== null) {
    const times = status.deliveries === 1 ? 'update' : 'updates';
    lines.push(
      `${status.deliveries} ${times} sent, last ${relative(
        status.lastDeliveredAt,
        now
      )}`
    );
  }
  if (status.lastError) lines.push(`Last poll failed: ${status.lastError}`);
  return {
    label: status.phase === 'pending' ? 'update pending' : 'babysitting',
    title: lines.join('\n'),
    tone: status.lastError ? 'warning' : 'info',
  };
}
