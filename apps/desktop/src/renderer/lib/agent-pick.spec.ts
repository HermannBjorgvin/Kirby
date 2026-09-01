import { describe, it, expect } from 'vitest';
import { agentIdForLaunch } from './agent-pick.js';

const agents = [
  { id: 'test' as const, name: 'Custom (default)' },
  { id: 'claude' as const, name: 'Claude' },
  { id: 'codex' as const, name: 'Codex' },
];

describe('agentIdForLaunch', () => {
  it('sends nothing for the default row, whatever agent it is', () => {
    expect(agentIdForLaunch(agents, 0)).toBeUndefined();
    expect(
      agentIdForLaunch([{ id: 'claude', name: 'Claude (default)' }], 0)
    ).toBeUndefined();
  });

  it('names a non-default pick', () => {
    expect(agentIdForLaunch(agents, 2)).toBe('codex');
  });

  it('never names the hidden test runner or a row that is gone', () => {
    expect(agentIdForLaunch([agents[1]!, agents[0]!], 1)).toBeUndefined();
    expect(agentIdForLaunch(agents, 9)).toBeUndefined();
  });
});
