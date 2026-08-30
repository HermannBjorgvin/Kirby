import { describe, it, expect, vi } from 'vitest';

// buildLaunchSpec is pure, but the module imports pty-registry (→ node-pty).
// Mock it so these stay fast, dependency-free unit tests.
vi.mock('../pty-registry.js', () => ({
  spawnSession: vi.fn(),
  getSession: vi.fn(),
}));

import { buildLaunchSpec } from './launch-session.js';
import type { AgentDefinition } from '../agents/registry.js';

const claude: AgentDefinition = {
  id: 'claude',
  name: 'Claude',
  supportsAppendSystemPrompt: true,
  blank: () => ({ cmd: 'claude', args: [] }),
  seed: (p, o) =>
    o?.appendSystemPrompt
      ? {
          cmd: 'claude',
          args: ['--append-system-prompt', o.appendSystemPrompt, p],
        }
      : { cmd: 'claude', args: [p] },
  continueOrBlank: () => ({
    cmd: '/bin/sh',
    args: ['-c', 'claude --continue || claude'],
  }),
  continueOrSeed: (p) => ({
    cmd: '/bin/sh',
    args: ['-c', 'claude --continue || claude "$KIRBY_SEED_PROMPT"'],
    env: { KIRBY_SEED_PROMPT: p },
  }),
};

// A no-continue, no-append agent (like Copilot).
const copilot: AgentDefinition = {
  id: 'copilot',
  name: 'Copilot',
  supportsAppendSystemPrompt: false,
  blank: () => ({ cmd: 'copilot', args: [] }),
  seed: (p) => ({ cmd: 'copilot', args: ['-i', p] }),
};

// An agent that can't seed at all — exercises the blank fallback.
const blankOnly: AgentDefinition = {
  id: 'test',
  name: 'Blank Only',
  supportsAppendSystemPrompt: false,
  blank: () => ({ cmd: 'noop', args: [] }),
};

describe('buildLaunchSpec', () => {
  it('blank → agent.blank()', () => {
    expect(buildLaunchSpec(claude, { intent: 'blank' })).toEqual({
      cmd: 'claude',
      args: [],
    });
  });

  it('continue-or-blank uses continueOrBlank when available', () => {
    expect(buildLaunchSpec(claude, { intent: 'continue-or-blank' })).toEqual({
      cmd: '/bin/sh',
      args: ['-c', 'claude --continue || claude'],
    });
  });

  it('continue-or-blank degrades to blank when the agent has no continue', () => {
    expect(buildLaunchSpec(copilot, { intent: 'continue-or-blank' })).toEqual({
      cmd: 'copilot',
      args: [],
    });
  });

  it('seed passes the prompt through', () => {
    expect(
      buildLaunchSpec(copilot, { intent: 'seed', prompt: 'do it' })
    ).toEqual({ cmd: 'copilot', args: ['-i', 'do it'] });
  });

  it('seed degrades to blank when the agent cannot seed', () => {
    expect(
      buildLaunchSpec(blankOnly, { intent: 'seed', prompt: 'do it' })
    ).toEqual({ cmd: 'noop', args: [] });
  });

  it('continue-or-seed degrades to seed when the agent has no continue', () => {
    expect(
      buildLaunchSpec(copilot, { intent: 'continue-or-seed', prompt: 'do it' })
    ).toEqual({ cmd: 'copilot', args: ['-i', 'do it'] });
  });

  describe('system guidance', () => {
    it('is passed natively for append-capable agents (Claude)', () => {
      const spec = buildLaunchSpec(claude, {
        intent: 'seed',
        prompt: 'review this',
        systemGuidance: 'use add-comment',
      });
      expect(spec).toEqual({
        cmd: 'claude',
        args: ['--append-system-prompt', 'use add-comment', 'review this'],
      });
    });

    it('is folded into the prompt for non-append agents', () => {
      const spec = buildLaunchSpec(copilot, {
        intent: 'seed',
        prompt: 'review this',
        systemGuidance: 'use add-comment',
      });
      expect(spec).toEqual({
        cmd: 'copilot',
        args: ['-i', 'use add-comment\n\nreview this'],
      });
    });

    it('threads guidance through Claude continue-or-seed via env', () => {
      const withOpts: AgentDefinition = {
        ...claude,
        continueOrSeed: (p, o) => ({
          cmd: '/bin/sh',
          args: [
            '-c',
            o?.appendSystemPrompt
              ? 'claude --continue || claude --append-system-prompt "$KIRBY_SEED_SYSTEM" "$KIRBY_SEED_PROMPT"'
              : 'claude --continue || claude "$KIRBY_SEED_PROMPT"',
          ],
          env: {
            KIRBY_SEED_PROMPT: p,
            ...(o?.appendSystemPrompt
              ? { KIRBY_SEED_SYSTEM: o.appendSystemPrompt }
              : {}),
          },
        }),
      };
      const spec = buildLaunchSpec(withOpts, {
        intent: 'continue-or-seed',
        prompt: 'the task',
        systemGuidance: 'the guidance',
      });
      expect(spec.env).toEqual({
        KIRBY_SEED_PROMPT: 'the task',
        KIRBY_SEED_SYSTEM: 'the guidance',
      });
    });
  });
});
