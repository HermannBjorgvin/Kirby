import type { AppConfig } from '@kirby/vcs-core';
import { AGENTS, resolveAgent, type AgentDefinition } from './registry.js';

export interface AgentOption {
  name: string;
  agent: AgentDefinition;
}

/**
 * Build the per-session agent option list shown in the session menu.
 *
 * The config-resolved agent comes first, labeled "(default)" — so Enter
 * with no cycling reproduces the configured behavior — followed by every
 * other selectable agent from the registry. A config that resolves to
 * the hidden test runner (a custom `aiCommand`) is labeled "Custom".
 */
export function buildAgentOptions(config: AppConfig): AgentOption[] {
  const defaultAgent = resolveAgent(config);
  const defaultName = defaultAgent.hidden ? 'Custom' : defaultAgent.name;
  return [
    { name: `${defaultName} (default)`, agent: defaultAgent },
    ...AGENTS.filter((a) => a.id !== defaultAgent.id).map((a) => ({
      name: a.name,
      agent: a,
    })),
  ];
}
