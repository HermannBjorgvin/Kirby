import { describe, expect, it } from 'vitest';
import type { BabysitStatus } from '../../../host/contract.js';
import { babysitBadge } from './babysit-badge.js';

const MIN = 60_000;

function status(over: Partial<BabysitStatus> = {}): BabysitStatus {
  return {
    prId: 7,
    sourceBranch: 'feat',
    phase: 'watching',
    held: null,
    lastPolledAt: null,
    pendingSince: null,
    lastDeliveredAt: null,
    deliveries: 0,
    lastError: null,
    ...over,
  };
}

describe('babysitBadge', () => {
  it('says it is watching when there is nothing to report', () => {
    expect(babysitBadge(status(), 0)).toEqual({
      label: 'babysitting',
      title: 'Watching CI, review threads and conflicts',
      tone: 'info',
    });
  });

  it('says an update is waiting, and for how long', () => {
    const badge = babysitBadge(
      status({ phase: 'pending', pendingSince: 0 }),
      7 * MIN
    );
    expect(badge.label).toBe('update pending');
    expect(badge.title).toContain('waiting since 7 min ago; sent once quiet');
  });

  it('says why a due update is being held', () => {
    const badge = babysitBadge(
      status({ phase: 'pending', pendingSince: 0, held: 'agent-busy' }),
      MIN
    );
    expect(badge.title).toContain('held until the agent has been quiet');
  });

  it('counts deliveries and flags a failed poll', () => {
    const badge = babysitBadge(
      status({
        deliveries: 2,
        lastDeliveredAt: 60 * MIN,
        lastError: 'gh: rate limited',
      }),
      150 * MIN
    );
    expect(badge.title).toContain('2 updates sent, last 1 h ago');
    expect(badge.title).toContain('Last poll failed: gh: rate limited');
    expect(badge.tone).toBe('warning');
  });
});
