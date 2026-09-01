import type { AgentId, AgentOptionView } from '../../host/contract.js';

/**
 * The agent a launch should carry, from the picker's selected row.
 *
 * Row 0 is the configured default: launching without touching the
 * picker reproduces the configured behaviour — a custom `aiCommand`
 * (the hidden `test` runner) included — so only a non-default pick
 * names an agent, and the hidden runner is never sent as one.
 */
export function agentIdForLaunch(
  agents: AgentOptionView[],
  index: number
): AgentId | undefined {
  if (index <= 0) return undefined;
  const picked = agents[index];
  if (!picked || picked.id === 'test') return undefined;
  return picked.id;
}
