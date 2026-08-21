import type { Key } from 'ink';
import type { AppConfig } from '@kirby/vcs-core';
import {
  createWorktree,
  listAllBranches,
  fetchRemote,
  branchToSessionName,
} from '@kirby/worktree-manager';
import { launchSession } from '../../session/launch-session.js';
import { handleTextInput } from '../../utils/handle-text-input.js';
import {
  AGENTS,
  resolveAgent,
  type AgentDefinition,
} from '../../agents/registry.js';
import type { BranchPickerHandlerCtx } from './input-types.js';

export interface AgentOption {
  name: string;
  agent: AgentDefinition;
}

/**
 * Build the per-session agent option list shown in the Branch Picker.
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

export function startAiSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
  config: AppConfig,
  agentOverride?: AgentDefinition
) {
  // Resume a prior conversation in this worktree if there is one, else
  // start blank. The launched agent decides whether continue is even
  // possible (only Claude, currently) — everyone else starts blank.
  launchSession({
    name,
    cwd,
    cols,
    rows,
    config,
    agent: agentOverride,
    request: { intent: 'continue-or-blank' },
  });
}

export function handleBranchPickerInput(
  input: string,
  key: Key,
  ctx: BranchPickerHandlerCtx
): void {
  const action = ctx.keybinds.resolve(input, key, 'branch-picker');

  if (action === 'branch-picker.cancel') {
    ctx.branchPicker.setCreating(false);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
    ctx.branchPicker.setAgentIndex(0);
    return;
  }

  if (action === 'branch-picker.fetch') {
    ctx.asyncOps.run('fetch-branches', async () => {
      // No "Fetching remotes…" flash — the 'fetch-branches' spinner
      // (label: "Fetching branches") already shows we're working.
      await fetchRemote();
      const allBranches = await listAllBranches();
      ctx.branchPicker.setBranches(allBranches);
      ctx.branchPicker.setBranchIndex(0);
      ctx.sessions.flashStatus('Fetched remotes');
    });
    return;
  }

  const agentOptions = buildAgentOptions(ctx.config.config);

  if (action === 'branch-picker.cycle-agent-left') {
    ctx.branchPicker.setAgentIndex(
      (i) => (i - 1 + agentOptions.length) % agentOptions.length
    );
    return;
  }
  if (action === 'branch-picker.cycle-agent-right') {
    ctx.branchPicker.setAgentIndex((i) => (i + 1) % agentOptions.length);
    return;
  }

  const filtered = ctx.branchPicker.branches.filter((b) =>
    b.toLowerCase().includes(ctx.branchPicker.branchFilter.toLowerCase())
  );

  if (action === 'branch-picker.navigate-up') {
    ctx.branchPicker.setBranchIndex((i) => Math.max(i - 1, 0));
    return;
  }
  if (action === 'branch-picker.navigate-down') {
    ctx.branchPicker.setBranchIndex((i) =>
      Math.min(i + 1, filtered.length - 1)
    );
    return;
  }

  if (action === 'branch-picker.select') {
    const branch =
      filtered.length > 0
        ? filtered[ctx.branchPicker.branchIndex]!
        : ctx.branchPicker.branchFilter.trim();
    if (branch) {
      const agentIdx = Math.min(
        Math.max(ctx.branchPicker.agentIndex, 0),
        agentOptions.length - 1
      );
      const agent = agentOptions[agentIdx]!.agent;
      ctx.asyncOps.run('create-worktree', async () => {
        const worktreePath = await createWorktree(branch);
        if (worktreePath) {
          const sessionName = branchToSessionName(branch);
          startAiSession(
            sessionName,
            ctx.terminal.paneCols,
            ctx.terminal.paneRows,
            worktreePath,
            ctx.config.config,
            agent
          );
          await ctx.sessions.refreshSessions();
          ctx.sidebar.selectByKey(`session:${sessionName}`);
        }
      });
    }
    ctx.branchPicker.setCreating(false);
    ctx.branchPicker.setBranchFilter('');
    ctx.branchPicker.setBranchIndex(0);
    ctx.branchPicker.setAgentIndex(0);
    return;
  }

  // Text input for branch filter (exempt from resolution)
  if (handleTextInput(input, key, ctx.branchPicker.setBranchFilter)) {
    ctx.branchPicker.setBranchIndex(0);
  }
}
