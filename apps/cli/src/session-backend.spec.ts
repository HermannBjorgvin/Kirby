import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';

const { ptyFactorySpy, tmuxFactorySpy, SENTINEL_PTY, SENTINEL_TMUX } =
  vi.hoisted(() => {
    return {
      ptyFactorySpy: vi.fn(),
      tmuxFactorySpy: vi.fn(),
      SENTINEL_PTY: Symbol('pty-factory'),
      SENTINEL_TMUX: Symbol('tmux-factory'),
    };
  });

vi.mock('@kirby/terminal-pty', () => ({
  createPtyBackendFactory: () => {
    ptyFactorySpy();
    return SENTINEL_PTY;
  },
}));
vi.mock('@kirby/terminal-tmux', () => ({
  createTmuxBackendFactory: (opts: { sessionPrefix?: string }) => {
    tmuxFactorySpy(opts);
    return SENTINEL_TMUX;
  },
}));
vi.mock('@kirby/vcs-core', () => ({
  projectKey: (cwd: string) => `hash(${cwd})`,
}));

import { buildSessionBackendFactory } from './session-backend.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    vendorAuth: {},
    vendorProject: {},
    ...overrides,
  };
}

beforeEach(() => {
  ptyFactorySpy.mockReset();
  tmuxFactorySpy.mockReset();
});

describe('buildSessionBackendFactory', () => {
  it('returns the PTY factory when terminalBackend is unset', () => {
    const factory = buildSessionBackendFactory(makeConfig(), '/repo');
    expect(factory).toBe(SENTINEL_PTY);
    expect(ptyFactorySpy).toHaveBeenCalledTimes(1);
    expect(tmuxFactorySpy).not.toHaveBeenCalled();
  });

  it('returns the PTY factory when terminalBackend is "pty"', () => {
    const factory = buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'pty' }),
      '/repo'
    );
    expect(factory).toBe(SENTINEL_PTY);
    expect(tmuxFactorySpy).not.toHaveBeenCalled();
  });

  it('returns the tmux factory with the kirby-<hash>- prefix when "tmux"', () => {
    const factory = buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/path/to/repo'
    );
    expect(factory).toBe(SENTINEL_TMUX);
    expect(tmuxFactorySpy).toHaveBeenCalledWith({
      sessionPrefix: 'kirby-hash(/path/to/repo)-',
    });
    expect(ptyFactorySpy).not.toHaveBeenCalled();
  });

  it('different repoRoots produce different prefixes', () => {
    buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/repo/a'
    );
    buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/repo/b'
    );
    expect(tmuxFactorySpy.mock.calls[0]?.[0]?.sessionPrefix).toBe(
      'kirby-hash(/repo/a)-'
    );
    expect(tmuxFactorySpy.mock.calls[1]?.[0]?.sessionPrefix).toBe(
      'kirby-hash(/repo/b)-'
    );
  });
});
