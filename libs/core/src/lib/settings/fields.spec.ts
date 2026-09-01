import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import type { TmuxStatus } from '@kirby/terminal-tmux';

const { isTmuxAvailableMock } = vi.hoisted(() => ({
  isTmuxAvailableMock: vi.fn<() => Promise<TmuxStatus>>(),
}));

// Only the probe is faked: the field model reads the *real*
// session-backend policy, so this asserts the two agree rather than
// asserting a second copy of the rule.
vi.mock('@kirby/terminal-tmux', () => ({
  createTmuxBackendFactory: () => ({}),
  isTmuxAvailable: () => isTmuxAvailableMock(),
  sanitizeTmuxSessionName: (n: string) => n,
  tmuxHasSession: () => false,
  tmuxKillSession: () => undefined,
}));
vi.mock('@kirby/terminal-pty', () => ({
  createPtyBackendFactory: () => ({}),
}));

import { probeTmuxAvailability } from '../session-backend.js';
import { buildSettingsFields, resolveValue } from './fields.js';

async function withTmux(available: boolean): Promise<void> {
  isTmuxAvailableMock.mockResolvedValueOnce(
    available
      ? { available: true, version: '3.4' }
      : {
          available: false,
          reason: 'tmux binary not found on PATH',
          installHint: 'brew install tmux',
        }
  );
  await probeTmuxAvailability();
}

function backendField() {
  const field = buildSettingsFields(null).find(
    (f) => f.key === 'terminalBackend'
  );
  if (!field) throw new Error('terminalBackend field is missing');
  return field;
}

const EMPTY_CONFIG: AppConfig = { vendorAuth: {}, vendorProject: {} };

beforeEach(() => {
  isTmuxAvailableMock.mockReset();
});

describe('terminal backend settings field', () => {
  it('defaults to tmux when the probe found a usable tmux', async () => {
    await withTmux(true);
    expect(backendField().defaultValue).toBe('tmux');
  });

  it('defaults to pty when tmux is missing, and says so on the preset', async () => {
    await withTmux(false);
    const field = backendField();
    expect(field.defaultValue).toBe('pty');
    expect(field.presets).toEqual([
      { name: 'PTY', value: 'pty' },
      { name: 'Tmux (not installed)', value: 'tmux' },
    ]);
  });

  // The "(default)" marker is rendered from `defaultValue`, so no preset
  // may carry one in its own name — the two would drift and the row
  // would read "PTY (default) (default)".
  it('leaves the default marker to the shells', async () => {
    await withTmux(true);
    const field = backendField();
    expect(field.presets).toEqual([
      { name: 'PTY', value: 'pty' },
      { name: 'Tmux', value: 'tmux' },
    ]);
    expect(field.description).toMatch(/tmux is installed/);
  });

  // resolveValue reports what is *stored*, never the default: an empty
  // string is the signal the shells use to render the default marker,
  // and the signal the write path uses to know nothing was chosen.
  it('resolves to the empty string while nothing is stored', async () => {
    await withTmux(true);
    expect(resolveValue(EMPTY_CONFIG, backendField())).toBe('');
    expect(
      resolveValue({ ...EMPTY_CONFIG, terminalBackend: 'pty' }, backendField())
    ).toBe('pty');
  });
});

describe('other settings fields', () => {
  it('carry no default, so the shells fall back to the first preset', async () => {
    await withTmux(true);
    const others = buildSettingsFields(null).filter(
      (f) => f.key !== 'terminalBackend'
    );
    expect(others.length).toBeGreaterThan(0);
    for (const field of others) {
      expect(field.defaultValue).toBeUndefined();
    }
  });
});
