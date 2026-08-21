import type { AppConfig } from '@kirby/vcs-core';
import { spawnSession, getSession, type PtyEntry } from '../pty-registry.js';
import {
  resolveAgent,
  type AgentDefinition,
  type LaunchSpec,
  type SeedOptions,
} from '../agents/registry.js';

// ── Session launcher ─────────────────────────────────────────────
//
// The single place that turns a high-level intent ("start a blank
// session", "seed a review", "resume or seed") plus the configured
// agent into a concrete PTY spawn. Every spawn call site routes through
// here so they all honor `config.agentId` and never hardcode `claude`
// or hand-build shell strings.

export type LaunchIntent =
  | 'blank'
  | 'continue-or-blank'
  | 'seed'
  | 'continue-or-seed';

export interface LaunchRequest {
  intent: LaunchIntent;
  /** Required for `seed` / `continue-or-seed`. */
  prompt?: string;
  /**
   * Optional guidance (e.g. "here's how to use Kirby's add-comment
   * command"). Delivered as a native system prompt for agents that
   * support it (Claude), folded into the prompt for the rest.
   */
  systemGuidance?: string;
}

function foldGuidance(
  agent: AgentDefinition,
  prompt: string,
  guidance: string | undefined
): { prompt: string; opts: SeedOptions | undefined } {
  if (!guidance) return { prompt, opts: undefined };
  if (agent.supportsAppendSystemPrompt) {
    return { prompt, opts: { appendSystemPrompt: guidance } };
  }
  return { prompt: `${guidance}\n\n${prompt}`, opts: undefined };
}

/**
 * Build the concrete {@link LaunchSpec} for an agent + request. Pure —
 * no spawning — so it's unit-testable. Degrades safely when the agent
 * lacks a capability (continue → blank/seed, seed → blank).
 */
export function buildLaunchSpec(
  agent: AgentDefinition,
  req: LaunchRequest
): LaunchSpec {
  switch (req.intent) {
    case 'blank':
      return agent.blank();
    case 'continue-or-blank':
      return agent.continueOrBlank?.() ?? agent.blank();
    case 'seed':
    case 'continue-or-seed': {
      const { prompt, opts } = foldGuidance(
        agent,
        req.prompt ?? '',
        req.systemGuidance
      );
      if (req.intent === 'continue-or-seed') {
        return (
          agent.continueOrSeed?.(prompt, opts) ??
          agent.seed?.(prompt, opts) ??
          agent.blank()
        );
      }
      return agent.seed?.(prompt, opts) ?? agent.blank();
    }
  }
}

export interface LaunchSessionParams {
  name: string;
  cwd: string;
  cols: number;
  rows: number;
  config: AppConfig;
  request: LaunchRequest;
}

/**
 * Resolve the configured agent, build its launch spec for the request,
 * and spawn the PTY. Returns the created entry.
 */
export function launchSession(params: LaunchSessionParams): PtyEntry {
  const agent = resolveAgent(params.config);
  const spec = buildLaunchSpec(agent, params.request);
  return spawnSession(
    params.name,
    spec.cmd,
    spec.args,
    params.cols,
    params.rows,
    params.cwd,
    spec.env
  );
}

/**
 * Deliver a prompt to an already-running session by typing it into the
 * REPL (non-destructive). The trailing carriage return submits it.
 * Returns false if the session isn't alive.
 */
export function deliverToRunningSession(name: string, prompt: string): boolean {
  const entry = getSession(name);
  if (!entry || entry.exited) return false;
  entry.pty.write(prompt + '\r');
  return true;
}
