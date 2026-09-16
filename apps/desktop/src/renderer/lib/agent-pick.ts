import type { AgentId, AgentOptionView } from '../../host/contract.js';

/** Resolve an explicit fresh-launch pick. Custom uses the directory config. */
export function agentIdForLaunch(
  agents: AgentOptionView[],
  index: number
): AgentId | undefined {
  if (index < 0) return undefined;
  const picked = agents[index];
  if (!picked || picked.id === 'test') return undefined;
  return picked.id;
}
