import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import type { TmuxStatus } from '@kirby/terminal-tmux';

const {
  ptyFactorySpy,
  tmuxFactorySpy,
  isTmuxAvailableMock,
  execFileSyncMock,
  tmuxHasSessionMock,
  tmuxKillSessionMock,
  readProjectConfigMock,
  SENTINEL_PTY,
  SENTINEL_TMUX,
} = vi.hoisted(() => {
  return {
    ptyFactorySpy: vi.fn(),
    tmuxFactorySpy: vi.fn(),
    isTmuxAvailableMock: vi.fn<() => Promise<TmuxStatus>>(),
    execFileSyncMock: vi.fn(),
    tmuxHasSessionMock: vi.fn<(name: string) => boolean>(),
    tmuxKillSessionMock: vi.fn<(name: string) => void>(),
    readProjectConfigMock: vi.fn<() => { terminalBackend?: string }>(),
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
  sanitizeTmuxSessionName: (name: string) => name,
  tmuxHasSession: (name: string) => tmuxHasSessionMock(name),
  tmuxKillSession: (name: string) => tmuxKillSessionMock(name),
}));
vi.mock('@kirby/vcs-core', () => ({
  projectKey: (cwd: string) => `hash(${cwd})`,
  readProjectConfig: () => readProjectConfigMock(),
}));

import {
  buildSessionBackendFactory,
  defaultTerminalBackend,
  getRepoRoot,
  hasLiveTmuxSession,
  isTmuxSessionPersisted,
  killPersistedTmuxSession,
  probeTmuxAvailability,
  projectTerminalBackendOverride,
  resetRepoRoot,
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
  tmuxHasSessionMock.mockReset();
  tmuxKillSessionMock.mockReset();
  readProjectConfigMock.mockReset();
  readProjectConfigMock.mockReturnValue({});
  // getRepoRoot memoizes for the process, so a test that let it resolve
  // to null would decide every later one. Reset and let it find /repo.
  resetRepoRoot();
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue('/repo\n');
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

// A tmux session outlives the preference that created it. Asking "is
// tmux selected?" where the question is "is a session running?" is how
// a live agent becomes invisible — and then has its worktree swept out
// from under it, or its directory deleted while it keeps working.
describe('tmux session existence vs. preference', () => {
  it('sees a live session whatever backend is now selected', () => {
    tmuxHasSessionMock.mockReturnValue(true);
    expect(hasLiveTmuxSession('feature-x')).toBe(true);
    expect(tmuxHasSessionMock).toHaveBeenCalledWith(
      'kirby-hash(/repo)-feature-x'
    );
  });

  it('reports no live session when tmux is unavailable', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    tmuxHasSessionMock.mockReturnValue(true);
    expect(hasLiveTmuxSession('feature-x')).toBe(false);
  });

  // The reattach decision is the one place the preference matters:
  // reattaching under PTY would spawn a second agent in the worktree
  // rather than resuming the one already running there.
  it('only reports a session as reattachable while tmux is selected', () => {
    tmuxHasSessionMock.mockReturnValue(true);
    expect(isTmuxSessionPersisted({}, 'feature-x')).toBe(true);
    expect(
      isTmuxSessionPersisted({ terminalBackend: 'pty' }, 'feature-x')
    ).toBe(false);
  });

  // The regression that motivated the split: a session created under
  // the tmux default must stay killable after the user picks PTY, or
  // removing its worktree deletes the directory and leaves the agent
  // running in it forever.
  it('kills a session created under a backend that is no longer selected', () => {
    killPersistedTmuxSession('feature-x');
    expect(tmuxKillSessionMock).toHaveBeenCalledWith(
      'kirby-hash(/repo)-feature-x'
    );
  });

  it('does not throw when there is no server or session', () => {
    tmuxKillSessionMock.mockImplementation(() => {
      throw new Error('no server running');
    });
    expect(() => killPersistedTmuxSession('feature-x')).not.toThrow();
  });
});

describe('projectTerminalBackendOverride', () => {
  it('reports the value the project config pins', () => {
    readProjectConfigMock.mockReturnValue({ terminalBackend: 'pty' });
    expect(projectTerminalBackendOverride('/repo')).toBe('pty');
  });

  it('reports nothing when the project pins nothing', () => {
    expect(projectTerminalBackendOverride('/repo')).toBeUndefined();
  });

  it('treats an unreadable project config as no override', () => {
    readProjectConfigMock.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(projectTerminalBackendOverride('/repo')).toBeUndefined();
  });
});
