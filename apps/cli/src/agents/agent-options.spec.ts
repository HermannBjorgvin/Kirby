import { describe, it, expect } from 'vitest';
import { buildAgentOptions } from './agent-options.js';

describe('buildAgentOptions', () => {
  it('marks the configured agent as the default and lists the rest after', () => {
    const opts = buildAgentOptions({ agentId: 'claude' });
    expect(opts[0]?.name).toBe('Claude (default)');
    expect(opts[0]?.agent.id).toBe('claude');
    expect(opts.map((o) => o.name)).toEqual([
      'Claude (default)',
      'Codex',
      'Gemini',
      'Copilot',
      'OpenCode',
    ]);
  });

  it('defaults to Claude for an empty config', () => {
    const opts = buildAgentOptions({});
    expect(opts[0]?.name).toBe('Claude (default)');
    expect(opts[0]?.agent.id).toBe('claude');
  });

  it('puts a non-Claude configured agent first', () => {
    const opts = buildAgentOptions({ agentId: 'codex' });
    expect(opts.map((o) => o.name)).toEqual([
      'Codex (default)',
      'Claude',
      'Gemini',
      'Copilot',
      'OpenCode',
    ]);
  });

  it('resolves a legacy aiCommand to its agent', () => {
    const opts = buildAgentOptions({ aiCommand: 'gemini' });
    expect(opts[0]?.name).toBe('Gemini (default)');
    expect(opts[0]?.agent.id).toBe('gemini');
  });

  it('labels an unrecognized aiCommand as Custom and keeps it launchable', () => {
    const opts = buildAgentOptions({ aiCommand: 'my-special-cli --foo' });
    expect(opts[0]?.name).toBe('Custom (default)');
    expect(opts[0]?.agent.blank()).toEqual({
      cmd: '/bin/sh',
      args: ['-c', 'my-special-cli --foo'],
    });
    expect(opts.slice(1).map((o) => o.name)).toEqual([
      'Claude',
      'Codex',
      'Gemini',
      'Copilot',
      'OpenCode',
    ]);
  });
});
