import {
  buildAgentOptions,
  getSessionLaunchContext as readSessionLaunchContext,
  resolveAgent,
  worktreeSessionKey,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import type { AgentOptionView, SessionLaunchView } from '../contract.js';
import { requireRepo } from './repo.js';

/**
 * The session menu's agent picker: the configured agent first (the
 * launch you get without touching the picker), then the rest of the
 * registry. Same list, same order, same labels as the TUI.
 */
export function listAgentOptions(): AgentOptionView[] {
  const config = readConfig(requireRepo());
  return buildAgentOptions(config).map((o) => ({
    id: o.agent.id,
    name: o.name,
  }));
}

/** Read native state when the menu opens; no registry-only resume guesses. */
export function getSessionLaunchContext(branch: string): SessionLaunchView {
  const cwd = requireRepo();
  const config = readConfig(cwd);
  return {
    ...readSessionLaunchContext(worktreeSessionKey(branch, cwd), config),
    defaultAgentName: resolveAgent(config).name,
  };
}
