import { worktreeSessionKey, terminalSessionKey } from './session-key.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '@kirby/vcs-core';
import type { TmuxSessionInfo, TmuxStatus } from '@kirby/terminal-tmux';
import type { DiscoveredWorktree } from './discovery/discovery-model.js';

const {
  ptyFactorySpy,
  tmuxFactorySpy,
  isTmuxAvailableMock,
  tmuxKillSessionMock,
  tmuxListSessionsMock,
  execFileSyncMock,
  readProjectConfigMock,
  liveSessionNamesMock,
  SENTINEL_PTY,
  SENTINEL_TMUX,
} = vi.hoisted(() => {
  return {
    ptyFactorySpy: vi.fn(),
    tmuxFactorySpy: vi.fn(),
    isTmuxAvailableMock: vi.fn<() => Promise<TmuxStatus>>(),
    tmuxKillSessionMock: vi.fn<(name: string) => void>(),
    tmuxListSessionsMock: vi.fn<() => TmuxSessionInfo[]>(),
    execFileSyncMock: vi.fn(),
    readProjectConfigMock: vi.fn<() => { terminalBackend?: string }>(),
    // Stands in for the PTY registry's own bookkeeping: which bare
    // session names this process currently holds alive, independent of
    // whatever the worktree list or tmux happen to report this scan.
    liveSessionNamesMock: vi.fn<() => string[]>(),
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
  createTmuxBackendFactory: (opts: unknown) => {
    tmuxFactorySpy(opts);
    return SENTINEL_TMUX;
  },
  isTmuxAvailable: () => isTmuxAvailableMock(),
  tmuxKillSession: (name: string) => tmuxKillSessionMock(name),
  tmuxListSessionsDetailed: () => tmuxListSessionsMock(),
}));
vi.mock('@kirby/vcs-core', () => ({
  readProjectConfig: () => readProjectConfigMock(),
}));
vi.mock('@kirby/worktree-manager', () => ({
  branchToSessionName: (branch: string) => branch.replace(/\//g, '-'),
}));
vi.mock('./pty-registry.js', () => ({
  setSessionBackendFactory: () => undefined,
  liveSessionNames: () => liveSessionNamesMock(),
}));
// The identity rules themselves are tmux-factory-options.spec.ts's;
// here only that they are composed for the right root.
vi.mock('./tmux-factory-options.js', () => ({
  kirbyTmuxFactoryOptions: (repoRoot: string) => ({ identityFor: repoRoot }),
}));

import {
  buildSessionBackendFactory,
  defaultTerminalBackend,
  getRepoRoot,
  hasLiveTmuxSession,
  hasLiveTmuxSessionNamed,
  isTmuxSessionNamedPersisted,
  killPersistedTmuxSession,
  observeTmuxSessions,
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

/** One of our sessions as the listing reports it: the name is any
 *  label, the identity is in the options. */
function ours(
  name: string,
  type: 'worktree' | 'shell' | 'agent',
  repo: string,
  branch: string | null,
  path: string,
  created = 1
): TmuxSessionInfo {
  return {
    name,
    created,
    path,
    options: {
      '@orchestra-spawner': 'kirby',
      '@orchestra-repo': repo,
      '@orchestra-session-type': type,
      ...(branch === null ? {} : { '@orchestra-branch': branch }),
    },
  };
}

/** A session nobody tagged — however it is named. */
function foreign(name: string, path = '/x'): TmuxSessionInfo {
  return { name, created: 1, path, options: {} };
}

function wt(name: string, branch: string, dir = name): DiscoveredWorktree {
  return {
    name: worktreeSessionKey(branch || name),
    branch,
    path: `/repo/.claude/worktrees/${dir}`,
  };
}

beforeEach(async () => {
  ptyFactorySpy.mockReset();
  tmuxFactorySpy.mockReset();
  isTmuxAvailableMock.mockReset();
  tmuxKillSessionMock.mockReset();
  tmuxListSessionsMock.mockReset();
  tmuxListSessionsMock.mockReturnValue([]);
  readProjectConfigMock.mockReset();
  readProjectConfigMock.mockReturnValue({});
  liveSessionNamesMock.mockReset();
  liveSessionNamesMock.mockReturnValue([]);
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

  // No repo root means nothing to tag a tmux session with, so the
  // default degrades exactly like an explicit "tmux" does.
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

  // The identity rules are keyed to the repo root: that is the string
  // every session is tagged with and every lookup matches on.
  it('builds the tmux factory over the identity rules for this repo root', () => {
    const factory = buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/path/to/repo'
    );
    expect(factory).toBe(SENTINEL_TMUX);
    expect(tmuxFactorySpy).toHaveBeenCalledWith({
      identityFor: '/path/to/repo',
    });
    expect(ptyFactorySpy).not.toHaveBeenCalled();
  });

  it('different repoRoots produce different identity rules', () => {
    buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/repo/a'
    );
    buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/repo/b'
    );
    expect(tmuxFactorySpy.mock.calls.map(([o]) => o)).toEqual([
      { identityFor: '/repo/a' },
      { identityFor: '/repo/b' },
    ]);
  });

  it('falls back to PTY when "tmux" requested but probe says unavailable', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    const factory = buildSessionBackendFactory(
      makeConfig({ terminalBackend: 'tmux' }),
      '/repo'
    );
    expect(factory).toBe(SENTINEL_PTY);
    expect(tmuxFactorySpy).not.toHaveBeenCalled();
  });

  // Outside a git working tree there is nothing stable to identify a
  // tmux session by. Keying off cwd instead would answer differently
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

/**
 * A registry name reaches a tmux session through its tags: a worktree
 * session whose tagged branch keys to the name, or a terminal tab
 * called exactly that. The name a session happens to carry is never
 * the answer — and a session that carries the right name with no tags
 * is somebody else's.
 */
describe('tmux session existence vs. preference', () => {
  it('sees a live session by its tags, whatever it is called, and whatever backend is now selected', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('some-label-2', 'worktree', '/repo', 'feature/x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature/x'))).toBe(true);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
  });

  // An orphaned worktree session adopted as an agent terminal is keyed
  // by its tmux name from then on, and keeps its `worktree` tag. A
  // terminal tab is process-global and outlives a repository switch, so
  // the name lookup answers whatever repository is open now.
  it('sees an adopted orphan by its tmux name while another repository is open', () => {
    resetRepoRoot();
    execFileSyncMock.mockReturnValue('/repo-b\n');
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-a-old', 'worktree', '/repo-a', 'old/branch', '/wt/dir'),
    ]);
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('repo-a-old'))).toBe(
      true
    );
    expect(
      isTmuxSessionNamedPersisted({}, terminalSessionKey('repo-a-old'))
    ).toBe(true);
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('repo-a-old-2'))).toBe(
      false
    );
  });

  it('never sees an untagged session by name', () => {
    tmuxListSessionsMock.mockReturnValue([foreign('repo-shell')]);
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('repo-shell'))).toBe(
      false
    );
  });

  it('does not see an untagged session that carries the expected name', () => {
    tmuxListSessionsMock.mockReturnValue([foreign('repo-feature-x')]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
    expect(hasLiveTmuxSession(worktreeSessionKey('repo-feature-x'))).toBe(
      false
    );
  });

  it('does not see another repository’s session for the same branch', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('other-feature-x', 'worktree', '/other', 'feature-x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
  });

  it('reports no live session when tmux is unavailable', async () => {
    isTmuxAvailableMock.mockResolvedValueOnce(TMUX_MISSING);
    await probeTmuxAvailability();
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feature-x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
    expect(tmuxListSessionsMock).not.toHaveBeenCalled();
  });

  // The reattach decision is the one place the preference matters:
  // reattaching under PTY would spawn a second agent in the worktree
  // rather than resuming the one already running there.
  it('only reports a named session as reattachable while tmux is selected', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-shell', 'shell', '/repo', null, '/repo'),
    ]);
    expect(
      isTmuxSessionNamedPersisted({}, terminalSessionKey('repo-shell'))
    ).toBe(true);
    expect(
      isTmuxSessionNamedPersisted(
        { terminalBackend: 'pty' },
        terminalSessionKey('repo-shell')
      )
    ).toBe(false);
  });

  // A registry key derived from a branch is `branchToSessionName(branch)`,
  // never a tmux name: repository `/w/feature` with an agent on branch
  // `x` is labelled `feature-x`, and removing the worktree of branch
  // `feature/x` asks about key `feature-x`. Nothing is on that branch,
  // and the name fallback must not reach the branch-`x` agent.
  it('never resolves a branch key to a worktree session by name', () => {
    resetRepoRoot();
    execFileSyncMock.mockReturnValue('/w/feature\n');
    tmuxListSessionsMock.mockReturnValue([
      ours('feature-x', 'worktree', '/w/feature', 'x', '/w/feature/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
    killPersistedTmuxSession(worktreeSessionKey('feature-x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
    expect(hasLiveTmuxSession(worktreeSessionKey('x'))).toBe(true);
  });

  // The regression that motivated the split: a session created under
  // the tmux default must stay killable after the user picks PTY, or
  // removing its worktree deletes the directory and leaves the agent
  // running in it forever. And the kill is aimed at the name the
  // resolver verified, not at a name composed from the branch.
  it('kills the tagged session for a registry name, by the name tmux holds it under', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-feature-x-3', 'worktree', '/repo', 'feature/x', '/wt/x'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('feature/x'));
    expect(tmuxKillSessionMock).toHaveBeenCalledWith('repo-feature-x-3');
  });

  it('refuses to kill an untagged session, even one carrying the expected name', () => {
    tmuxListSessionsMock.mockReturnValue([
      foreign('repo-feature-x'),
      foreign('feature-x'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('feature-x'));
    killPersistedTmuxSession(worktreeSessionKey('repo-feature-x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
  });

  it('refuses to kill another repository’s session', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('feature-x', 'worktree', '/other', 'feature-x', '/wt/x'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('feature-x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
  });

  it('does not throw when there is no server or session', () => {
    tmuxListSessionsMock.mockImplementation(() => {
      throw new Error('no server running');
    });
    expect(() =>
      killPersistedTmuxSession(worktreeSessionKey('feature-x'))
    ).not.toThrow();
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
  });

  it('is empty outside a git working tree', () => {
    resetRepoRoot();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feature-x', '/wt/x'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('feature-x'))).toBe(false);
    killPersistedTmuxSession(worktreeSessionKey('feature-x'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
  });
});

describe('terminal tabs reach tmux by their own name', () => {
  it('sees a terminal tab by name and type, from any repository', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('notes-shell', 'shell', '/elsewhere', null, '/home/dev/notes'),
    ]);
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('notes-shell'))).toBe(
      true
    );
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('notes-shell-2'))).toBe(
      false
    );
    // A registry *key* never reaches a terminal tab: keys are branches.
    expect(hasLiveTmuxSession(worktreeSessionKey('notes-shell'))).toBe(false);
  });

  // A branch may be named exactly like a terminal label: branch
  // `app-agent` in repository `/w/app` has key `app-agent`, which is
  // also the user's agent tab. Removing that branch's worktree asks the
  // key path about `app-agent`; nothing is on that branch, and the tab
  // must not answer for it — and must not be killed in its place.
  it('never kills an agent tab whose name equals a branch key', () => {
    resetRepoRoot();
    execFileSyncMock.mockReturnValue('/w/app\n');
    tmuxListSessionsMock.mockReturnValue([
      ours('app-agent', 'agent', '/w/app', null, '/w/app'),
    ]);
    expect(hasLiveTmuxSession(worktreeSessionKey('app-agent'))).toBe(false);
    killPersistedTmuxSession(worktreeSessionKey('app-agent'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
    // The tab itself is still reachable by name.
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('app-agent'))).toBe(true);
  });

  // A tab is closed through its own registry entry, whose backend
  // holds the name tmux created. The key path reaches neither it nor a
  // stranger of that name, so nothing here is killed by either route.
  it('a registry key kills neither a terminal tab nor a foreign session of that name', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-shell', 'shell', '/repo', null, '/repo'),
      foreign('repo-shell-2'),
    ]);
    killPersistedTmuxSession(worktreeSessionKey('repo-shell'));
    killPersistedTmuxSession(worktreeSessionKey('repo-shell-2'));
    expect(tmuxKillSessionMock).not.toHaveBeenCalled();
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('repo-shell'))).toBe(
      true
    );
    expect(hasLiveTmuxSessionNamed(terminalSessionKey('repo-shell-2'))).toBe(
      false
    );
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

/**
 * One listing, read through the tags: which worktrees have a session,
 * which terminal tabs exist, and which worktree sessions are orphans.
 */
describe('observeTmuxSessions', () => {
  const tmuxConfig = makeConfig({ terminalBackend: 'tmux' });

  it('reports a worktree as persisted when a session is tagged with its repo and branch', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('whatever', 'worktree', '/repo', 'feat/a', '/wt/feat-a'),
      ours('repo-feat-b', 'worktree', '/repo', 'feat-b', '/wt/feat-b'),
    ]);
    const seen = observeTmuxSessions(tmuxConfig, [
      wt('feat-a', 'feat/a'),
      wt('feat-b', 'feat-b'),
      wt('gone', 'gone'),
    ]);
    expect(seen.persisted).toEqual(
      new Set([worktreeSessionKey('feat/a'), worktreeSessionKey('feat-b')])
    );
    expect(seen.terminals).toEqual([]);
  });

  // A session named exactly what Kirby would have chosen, with no
  // tags, is foreign: neither a persisted worktree nor a terminal.
  it('ignores an untagged session whatever it is called', () => {
    tmuxListSessionsMock.mockReturnValue([
      foreign('repo-feat-a', '/wt/feat-a'),
      foreign('repo-shell', '/repo'),
    ]);
    expect(observeTmuxSessions(tmuxConfig, [wt('feat-a', 'feat-a')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });

  it('ignores another repository’s worktree sessions', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('feat-a', 'worktree', '/other', 'feat-a', '/other/wt/feat-a'),
    ]);
    expect(observeTmuxSessions(tmuxConfig, [wt('feat-a', 'feat-a')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });

  // A detached-HEAD worktree has no branch; its session is tagged with
  // the directory's name, which is also its registry name.
  it('matches a detached worktree by its directory name', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-hotfix-dir', 'worktree', '/repo', 'hotfix-dir', '/wt/x'),
    ]);
    const seen = observeTmuxSessions(tmuxConfig, [wt('hotfix-dir', '')]);
    expect(seen.persisted).toEqual(new Set([worktreeSessionKey('hotfix-dir')]));
  });

  // Terminals belong to a directory, not to the repository the scan
  // runs for: one started in another checkout, or in no checkout at
  // all, is still this user's terminal and must reopen. The kind is
  // the tag, not anything about the name.
  it('reports every terminal session by its session type, with its directory, wherever it runs', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('notes-shell', 'shell', '/elsewhere', null, '/home/dev/notes'),
      ours('repo-agent-2', 'agent', '/repo', null, '/repo'),
      ours('odd-name', 'shell', '/repo', null, '/repo'),
    ]);
    expect(observeTmuxSessions(tmuxConfig, []).terminals).toEqual([
      {
        name: terminalSessionKey('notes-shell'),
        kind: 'shell',
        path: '/home/dev/notes',
      },
      {
        name: terminalSessionKey('repo-agent-2'),
        kind: 'agent',
        path: '/repo',
      },
      { name: terminalSessionKey('odd-name'), kind: 'shell', path: '/repo' },
    ]);
  });

  // An agent that checks out another branch inside its worktree leaves
  // a session tagged with the old branch, which no worktree is on any
  // more. It surfaces as an agent terminal in its directory rather than
  // vanishing — the session is still running.
  it('surfaces a worktree session whose branch no worktree is on as an agent terminal', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-old-branch', 'worktree', '/repo', 'old-branch', '/wt/dir'),
    ]);
    const seen = observeTmuxSessions(tmuxConfig, [
      wt('new-branch', 'new-branch', 'dir'),
    ]);
    expect(seen.persisted).toEqual(new Set());
    expect(seen.terminals).toEqual([
      {
        name: terminalSessionKey('repo-old-branch'),
        kind: 'agent',
        path: '/wt/dir',
      },
    ]);
  });

  // The registry keys a worktree session by the branch it was spawned
  // under, which is exactly what checking out another branch inside
  // the worktree leaves stale — and stale is not gone: this process is
  // still driving it. Reporting it as an orphan is how `adoptTerminal`
  // attaches a second client to a session already live behind another
  // tab, so it must never be offered while the registry still holds it.
  it('never reports a session this process already holds as an orphan terminal', () => {
    liveSessionNamesMock.mockReturnValue([worktreeSessionKey('old/branch')]);
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-old-branch', 'worktree', '/repo', 'old/branch', '/wt/dir'),
    ]);
    const seen = observeTmuxSessions(tmuxConfig, [
      wt('new-branch', 'new-branch', 'dir'),
    ]);
    expect(seen.terminals).toEqual([]);
  });

  it('costs one fork for both answers', () => {
    observeTmuxSessions(tmuxConfig, [wt('a', 'a'), wt('b', 'b')]);
    expect(tmuxListSessionsMock).toHaveBeenCalledTimes(1);
  });

  // tmux-cli hands back '' for a list-sessions line it could not split
  // on a tab, not a real directory. A terminal tab needs somewhere to
  // run and display, so a pathless line must be dropped rather than
  // opening a tab onto nothing — for a terminal and for an orphaned
  // worktree session alike.
  it('drops a session with no reported path', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-shell', 'shell', '/repo', null, ''),
      ours('repo-old', 'worktree', '/repo', 'old', ''),
    ]);
    expect(observeTmuxSessions(tmuxConfig, []).terminals).toEqual([]);
  });

  it('sees nothing on the pty backend, without forking', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('repo-shell', 'shell', '/repo', null, '/repo'),
    ]);
    expect(
      observeTmuxSessions(makeConfig({ terminalBackend: 'pty' }), [])
    ).toEqual({ persisted: new Set(), terminals: [] });
    expect(tmuxListSessionsMock).not.toHaveBeenCalled();
  });

  // The backend in force, not the raw config field: with tmux the
  // detected default, a user who never chose one is on tmux.
  it('answers for a user who never chose a backend', () => {
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feat-a', '/wt/feat-a'),
    ]);
    expect(observeTmuxSessions(makeConfig(), [wt('feat-a', 'feat-a')])).toEqual(
      { persisted: new Set([worktreeSessionKey('feat-a')]), terminals: [] }
    );
  });

  it('is empty outside a git working tree', () => {
    resetRepoRoot();
    execFileSyncMock.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });
    tmuxListSessionsMock.mockReturnValue([
      ours('x', 'worktree', '/repo', 'feat-a', '/wt/feat-a'),
    ]);
    expect(observeTmuxSessions(tmuxConfig, [wt('feat-a', 'feat-a')])).toEqual({
      persisted: new Set(),
      terminals: [],
    });
  });
});
