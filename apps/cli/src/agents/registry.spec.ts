import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import {
  AGENTS,
  agentIdFromCommand,
  makeTestAgent,
  resolveAgent,
  isKnownAgentId,
  SEED_PROMPT_ENV,
  SEED_SYSTEM_ENV,
} from './registry.js';

function config(partial: Partial<AppConfig>): AppConfig {
  return { vendorAuth: {}, vendorProject: {}, ...partial };
}

describe('agent registry', () => {
  it('exposes the five user-selectable agents, none hidden', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'claude',
      'codex',
      'gemini',
      'copilot',
      'opencode',
    ]);
    expect(AGENTS.every((a) => !a.hidden)).toBe(true);
  });

  describe('agentIdFromCommand', () => {
    it('defaults to claude when empty', () => {
      expect(agentIdFromCommand(undefined)).toBe('claude');
      expect(agentIdFromCommand('')).toBe('claude');
    });

    it('maps legacy preset strings back to their agent', () => {
      expect(agentIdFromCommand('claude --continue || claude')).toBe('claude');
      expect(agentIdFromCommand('codex')).toBe('codex');
      expect(agentIdFromCommand('gemini')).toBe('gemini');
      expect(agentIdFromCommand('copilot')).toBe('copilot');
      expect(agentIdFromCommand('gh copilot')).toBe('copilot');
      expect(agentIdFromCommand('opencode')).toBe('opencode');
    });

    it('routes unrecognized commands to the hidden test runner', () => {
      expect(agentIdFromCommand('cat')).toBe('test');
      expect(agentIdFromCommand('echo hi && sleep 300')).toBe('test');
      expect(agentIdFromCommand('node /tmp/fake-agent.mjs')).toBe('test');
    });
  });

  describe('resolveAgent', () => {
    it('prefers explicit agentId over aiCommand', () => {
      const agent = resolveAgent(
        config({ agentId: 'codex', aiCommand: 'cat' })
      );
      expect(agent.id).toBe('codex');
    });

    it('migrates legacy aiCommand when agentId is unset', () => {
      expect(resolveAgent(config({ aiCommand: 'gemini' })).id).toBe('gemini');
    });

    it('routes an unrecognized aiCommand to the test runner that runs it raw', () => {
      const agent = resolveAgent(config({ aiCommand: 'cat' }));
      expect(agent.id).toBe('test');
      expect(agent.hidden).toBe(true);
      expect(agent.blank()).toEqual({ cmd: '/bin/sh', args: ['-c', 'cat'] });
    });

    it('defaults to claude with an empty config', () => {
      expect(resolveAgent(config({})).id).toBe('claude');
    });
  });

  describe('launch specs', () => {
    const claude = AGENTS.find((a) => a.id === 'claude')!;
    const copilot = AGENTS.find((a) => a.id === 'copilot')!;
    const codex = AGENTS.find((a) => a.id === 'codex')!;
    const gemini = AGENTS.find((a) => a.id === 'gemini')!;
    const opencode = AGENTS.find((a) => a.id === 'opencode')!;

    it('claude blank / seed pass the prompt as one argv element', () => {
      expect(claude.blank()).toEqual({ cmd: 'claude', args: [] });
      expect(claude.seed!('weird \'quotes\' and "dquotes"')).toEqual({
        cmd: 'claude',
        args: ['weird \'quotes\' and "dquotes"'],
      });
    });

    it('claude seed uses --append-system-prompt when guidance is given', () => {
      expect(
        claude.seed!('do the thing', { appendSystemPrompt: 'be nice' })
      ).toEqual({
        cmd: 'claude',
        args: ['--append-system-prompt', 'be nice', 'do the thing'],
      });
    });

    it('claude continue-or-seed delivers the prompt via env, not the command string', () => {
      const spec = claude.continueOrSeed!('the plan');
      expect(spec.cmd).toBe('/bin/sh');
      expect(spec.args[0]).toBe('-c');
      expect(spec.args[1]).toBe(
        `claude --continue || claude "$${SEED_PROMPT_ENV}"`
      );
      expect(spec.args[1]).not.toContain('the plan');
      expect(spec.env).toEqual({ [SEED_PROMPT_ENV]: 'the plan' });
    });

    it('claude continue-or-seed threads the system prompt via env too', () => {
      const spec = claude.continueOrSeed!('the plan', {
        appendSystemPrompt: 'guidance',
      });
      expect(spec.args[1]).toBe(
        `claude --continue || claude --append-system-prompt "$${SEED_SYSTEM_ENV}" "$${SEED_PROMPT_ENV}"`
      );
      expect(spec.env).toEqual({
        [SEED_PROMPT_ENV]: 'the plan',
        [SEED_SYSTEM_ENV]: 'guidance',
      });
    });

    it('copilot seeds with -i and has no continue', () => {
      expect(copilot.seed!('hi')).toEqual({
        cmd: 'copilot',
        args: ['-i', 'hi'],
      });
      expect(copilot.continueOrBlank).toBeUndefined();
      expect(copilot.continueOrSeed).toBeUndefined();
    });

    it('codex/gemini/opencode seed with their respective flags', () => {
      expect(codex.seed!('p')).toEqual({ cmd: 'codex', args: ['p'] });
      expect(gemini.seed!('p')).toEqual({ cmd: 'gemini', args: ['-i', 'p'] });
      expect(opencode.seed!('p')).toEqual({
        cmd: 'opencode',
        args: ['--prompt', 'p'],
      });
    });

    it('only claude advertises append-system-prompt support', () => {
      expect(claude.supportsAppendSystemPrompt).toBe(true);
      for (const a of [copilot, codex, gemini, opencode]) {
        expect(a.supportsAppendSystemPrompt).toBe(false);
      }
    });
  });

  describe('makeTestAgent', () => {
    it('runs the raw command and exposes the seed prompt via env', () => {
      const agent = makeTestAgent('cat');
      expect(agent.blank()).toEqual({ cmd: '/bin/sh', args: ['-c', 'cat'] });
      expect(agent.seed!('hello')).toEqual({
        cmd: '/bin/sh',
        args: ['-c', 'cat'],
        env: { [SEED_PROMPT_ENV]: 'hello' },
      });
    });
  });

  describe('isKnownAgentId', () => {
    it('recognizes the public ids but not the hidden test runner', () => {
      expect(isKnownAgentId('claude')).toBe(true);
      expect(isKnownAgentId('opencode')).toBe(true);
      expect(isKnownAgentId('test')).toBe(false);
      expect(isKnownAgentId('nonsense')).toBe(false);
    });
  });
});
