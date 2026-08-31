import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import type { TmuxStatus } from '@kirby/terminal-tmux';

const {
  ptyFactorySpy,
  tmuxFactorySpy,
  isTmuxAvailableMock,
  execFileSyncMock,
  SENTINEL_PTY,
  SENTINEL_TMUX,
} = vi.hoisted(() => {
  return {
    ptyFactorySpy: vi.fn(),
    tmuxFactorySpy: vi.fn(),
    isTmuxAvailableMock: vi.fn<() => Promise<TmuxStatus>>(),
    execFileSyncMock: vi.fn(),
    SENTINEL_PTY: Symbol('pty-factory'),
    SENTINEL_TMUX: Symbol('tmux-factory'),
  };
});

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

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
  isTmuxAvailable: () => isTmuxAvailableMock(),
}));
vi.mock('@kirby/vcs-core', () => ({
  projectKey: (cwd: string) => `hash(${cwd})`,
}));

import {
  buildSessionBackendFactory,
  defaultTerminalBackend,
  getRepoRoot,
  probeTmuxAvailability,
  resolveTerminalBackend,
} from './session-backend.js';

const TMUX_OK: TmuxStatus = { available: true, version: '3.4' };
const TMUX_MISSING: TmuxStatus = {
  available: false,
  reason: 'tmux binary not found on PATH',
  installHint: 'brew install tmux',
};

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    vendorAuth: {},
    vendorProject: {},
    ...overrides,
  };
}

beforeEach(async () => {
  ptyFactorySpy.mockReset();
  tmuxFactorySpy.mockReset();
  isTmuxAvailableMock.mockReset();
  // Reset module-level cachedTmuxStatus to a known "available" state so
  // tests that don't care about the probe see the un-fallback path.
  // Tests asserting the fallback re-call probeTmuxAvailability with an
  // "unavailable" mock to override.
  isTmuxAvailableMock.mockResolvedValueOnce({
    available: true,
    version: '3.4',
  });
  await probeTmuxAvailability();
  isTmuxAvailableMock.mockReset();
});

// The whole point of the default: a machine with tmux gets session
// persistence without anyone opting in, and a machine without it — or a
// user who said "pty" once — is never surprised by a backend switch.
describe('resolveTerminalBackend', () => {
  it.each([
    ['unset + tmux available', undefined, TMUX_OK, 'tmux'],
    ['unset + tmux unavailable', undefined, TMUX_MISSING, 'pty'],
    ['unset + probe not finished', undefined, null, 'pty'],
    ['explicit pty + tmux available', 'pty', TMUX_OK, 'pty'],
    ['explicit pty + tmux unavailable', 'pty', TMUX_MISSING, 'pty'],
    ['explicit tmux + tmux available', 'tmux', TMUX_OK, 'tmux'],
  ] as const)('%s → %s', (_label, stored, status, expected) => {
    expect(resolveTerminalBackend({ terminalBackend: stored }, status)).toBe(
      expected
    );
  });

  // An explicit "pty" outlives the probe forever: the user chose it, and
  // installing tmux later must not silently move their sessions.
  it('never upgrades an explicit "pty" to tmux', () => {
    expect(resolveTerminalBackend({ terminalBackend: 'pty' }, TMUX_OK)).toBe(
      'pty'
    );
  });

  it('reads the cached probe when no status is passed', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    expect(resolveTerminalBackend({})).toBe('pty');
    expect(defaultTerminalBackend()).toBe('pty');

    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_OK);
    await probeTmuxAvailability();
    expect(resolveTerminalBackend({})).toBe('tmux');
    expect(defaultTerminalBackend()).toBe('tmux');
  });
});

describe('buildSessionBackendFactory', () => {
  it('returns the tmux factory when terminalBackend is unset and tmux is available', () => {
    const factory = buildSessionBackendFactory(makeConfig(), '/repo');
    expect(factory).toBe(SENTINEL_TMUX);
    expect(ptyFactorySpy).not.toHaveBeenCalled();
  });

  it('returns the PTY factory when terminalBackend is unset and tmux is missing', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    const factory = buildSessionBackendFactory(makeConfig(), '/repo');
    expect(factory).toBe(SENTINEL_PTY);
    expect(ptyFactorySpy).toHaveBeenCalledTimes(1);
    expect(tmuxFactorySpy).not.toHaveBeenCalled();
  });

  // No repo root means no stable key to namespace a tmux session by, so
  // the default degrades exactly like an explicit "tmux" does.
  it('returns the PTY factory when the default is tmux but there is no repo root', () => {
    const factory = buildSessionBackendFactory(makeConfig(), null);
    expect(factory).toBe(SENTINEL_PTY);
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

  it('falls back to PTY when "tmux" requested but probe says unavailable', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce({
      available: false,
      reason: 'tmux binary not found on PATH',
      installHint: 'brew install tmux',
    });
    await probeTmuxAvailability();
    const factory = buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/repo'
    );
    expect(factory).toBe(SENTINEL_PTY);
    expect(tmuxFactorySpy).not.toHaveBeenCalled();
  });

  // Outside a git working tree there is no stable key to namespace the
  // tmux session name by. Keying off cwd instead would hash differently
  // per subdirectory and strand the previous session, so degrade to PTY.
  it.each([
    ['null', null],
    ['empty string', ''],
  ])('falls back to PTY when repoRoot is %s', (_label, repoRoot) => {
    const factory = buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      repoRoot
    );
    expect(factory).toBe(SENTINEL_PTY);
    expect(tmuxFactorySpy).not.toHaveBeenCalled();
  });
});

describe('getRepoRoot', () => {
  // One test rather than two: getRepoRoot memoizes, so a second test
  // would read the cache and never re-invoke execFileSync.
  it('returns null outside a git working tree, without throwing', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    // Runs inside a useEffect — a throw here would take the render down
    // rather than surfacing as a recoverable error.
    expect(getRepoRoot()).toBeNull();

    // stderr is swallowed, not inherited: git's "fatal:" line written
    // straight to the terminal would land mid-frame and corrupt Ink's
    // render.
    expect(execFileSyncMock).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--show-toplevel'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'ignore'] })
    );

    // Memoized, including the failure — no repeated forks per render.
    expect(getRepoRoot()).toBeNull();
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
  });
});
