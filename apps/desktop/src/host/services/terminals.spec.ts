import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TerminalsModule from './terminals.js';

/**
 * The desktop's terminal tabs: sessions that belong to a directory
 * rather than a worktree. What the host adds over `@kirby/core`'s
 * launcher is bookkeeping — which directory, which kind, whether the
 * directory is a repository root (and so which tab group), the output
 * relay — and none of it may depend on which repository is open.
 */

const state = vi.hoisted(() => ({
  alive: new Set<string>(),
  spawns: [] as {
    name: string;
    kind: string;
    cwd: string;
    config: unknown;
  }[],
  killed: [] as string[],
  released: [] as string[],
  onData: new Map<string, (data: string) => void>(),
  onExit: new Map<string, ((code: number) => void)[]>(),
  // One session object per spawn, as the registry holds one entry per
  // spawn: the host tells a session's exit from a successor's by
  // identity, so the mock must not hand out a fresh object per read.
  sessions: new Map<string, { exited: boolean; pty: unknown }>(),
  configByCwd: {} as Record<string, unknown>,
  repoRoots: new Set<string>(),
  recents: [] as string[],
  nextId: 0,
  // Every path used across this file is a real directory as far as
  // launchTerminal's cwd check is concerned, unless a test says
  // otherwise — the check itself is exercised by its own describe
  // block, with a controlled path list.
  missingDirs: new Set<string>(),
}));

vi.mock('node:fs', () => ({
  statSync: (p: string) => {
    if (state.missingDirs.has(p)) throw new Error('ENOENT');
    return { isDirectory: () => true };
  },
}));

vi.mock('./repo.js', () => ({
  isGitRepo: (cwd: string) => state.repoRoots.has(cwd),
}));

vi.mock('./recent-repos.js', () => ({
  ensureRecent: (cwd: string) => {
    if (!state.recents.includes(cwd)) state.recents.push(cwd);
  },
}));

vi.mock('@kirby/vcs-core', () => ({
  readConfig: (cwd: string) => state.configByCwd[cwd] ?? { fromCwd: cwd },
}));

vi.mock('@kirby/core', () => ({
  newTerminalSessionName: (kind: string) => {
    state.nextId += 1;
    return `kirby-term-${kind}-${state.nextId.toString(16).padStart(6, '0')}`;
  },
  launchTerminalSession: (spec: {
    name: string;
    kind: string;
    cwd: string;
    config: unknown;
  }) => {
    state.alive.add(spec.name);
    state.spawns.push({
      name: spec.name,
      kind: spec.kind,
      cwd: spec.cwd,
      config: spec.config,
    });
    const name = spec.name;
    state.onExit.set(name, []);
    state.sessions.set(name, {
      exited: false,
      pty: {
        onData: (cb: (data: string) => void) => state.onData.set(name, cb),
        onExit: (cb: (code: number) => void) =>
          state.onExit.get(name)?.push(cb),
      },
    });
  },
  getSession: (name: string) => state.sessions.get(name),
  killSession: (name: string) => {
    state.killed.push(name);
    state.alive.delete(name);
    state.sessions.delete(name);
  },
  releaseExitedSession: (name: string) => {
    state.released.push(name);
    state.sessions.delete(name);
  },
  isSessionAlive: (name: string) => state.alive.has(name),
  getSpawnedAt: () => 1000,
}));

let terminals: typeof TerminalsModule;

beforeEach(async () => {
  state.alive = new Set();
  state.spawns = [];
  state.killed = [];
  state.released = [];
  state.onData = new Map();
  state.onExit = new Map();
  state.sessions = new Map();
  state.configByCwd = {};
  state.repoRoots = new Set(['/home/dev/kirby', '/home/dev/other']);
  state.recents = [];
  state.nextId = 0;
  state.missingDirs = new Set();
  vi.resetModules();
  terminals = await import('./terminals.js');
});

const HOME = '/home/dev';

describe('launchTerminal', () => {
  it('opens a shell in a plain folder, belonging to no repository', () => {
    const summary = terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/notes' },
      HOME
    );
    expect(state.spawns).toEqual([
      expect.objectContaining({ kind: 'shell', cwd: '/home/dev/notes' }),
    ]);
    expect(summary).toMatchObject({
      kind: 'shell',
      cwd: '/home/dev/notes',
      displayPath: '~/notes',
      repo: null,
      running: true,
    });
    expect(state.recents).toEqual([]);
  });

  // A repository root joins that repository's group, and is put on the
  // repo list so the workspace can switch to it like any other repo.
  it('binds a terminal at a repository root to that repository', () => {
    const summary = terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    expect(summary.repo).toBe('/home/dev/other');
    expect(state.recents).toEqual(['/home/dev/other']);
  });

  it('treats a subfolder of a repository as a plain folder', () => {
    const summary = terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/kirby/apps' },
      HOME
    );
    expect(summary.repo).toBeNull();
    expect(state.recents).toEqual([]);
  });

  it('gives each terminal in the same directory its own session', () => {
    const a = terminals.launchTerminal({ kind: 'shell', cwd: '/x' }, HOME);
    const b = terminals.launchTerminal({ kind: 'shell', cwd: '/x' }, HOME);
    expect(a.name).not.toBe(b.name);
    expect(terminals.listTerminals(HOME).map((t) => t.name)).toEqual([
      a.name,
      b.name,
    ]);
  });

  // An agent at a repository root should be that repository's agent —
  // per-project config is keyed by the directory it is read for.
  it('reads config for the directory the terminal opens in', () => {
    state.configByCwd['/home/dev/other'] = { marker: 'other-config' };
    terminals.launchTerminal({ kind: 'agent', cwd: '/home/dev/other' }, HOME);
    expect(state.spawns[0].config).toEqual({ marker: 'other-config' });
  });

  it('relays the session’s output into a buffer the renderer can replay', () => {
    const { name } = terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    state.onData.get(name)?.('$ ');
    state.onData.get(name)?.('ls\r\n');
    expect(terminals.terminalBuffer(name)).toEqual({
      data: '$ ls\r\n',
      seq: 2,
    });
  });

  // A relative or missing directory otherwise reaches node-pty or the
  // tmux client, which fail opaquely — `posix_spawnp failed`, or a
  // client that exits the instant it starts — naming neither the
  // problem nor which of the two backends hit it.
  describe('rejects a directory it cannot actually launch into', () => {
    it('refuses a relative path', () => {
      expect(() =>
        terminals.launchTerminal({ kind: 'shell', cwd: 'relative/dir' }, HOME)
      ).toThrow(/absolute path/);
      expect(state.spawns).toEqual([]);
    });

    it('refuses a path that does not exist', () => {
      state.missingDirs.add('/home/dev/gone');
      expect(() =>
        terminals.launchTerminal({ kind: 'shell', cwd: '/home/dev/gone' }, HOME)
      ).toThrow(/does not exist/);
      expect(state.spawns).toEqual([]);
    });
  });
});

describe('adoptTerminal', () => {
  // The restore path: the name and directory come from tmux, and the
  // launch reattaches under exactly that name.
  it('reattaches under the name and in the directory tmux reported', () => {
    terminals.adoptTerminal({
      name: 'kirby-term-shell-1a2b3c',
      kind: 'shell',
      path: '/home/dev/notes',
    });
    expect(state.spawns).toEqual([
      expect.objectContaining({
        name: 'kirby-term-shell-1a2b3c',
        kind: 'shell',
        cwd: '/home/dev/notes',
      }),
    ]);
    expect(terminals.listTerminals(HOME)).toEqual([
      expect.objectContaining({
        name: 'kirby-term-shell-1a2b3c',
        repo: null,
        displayPath: '~/notes',
      }),
    ]);
  });

  // A terminal restored at a repository root the user has since
  // forgotten still needs its repository on the list: activating its
  // tab opens that repository.
  it('puts a restored terminal’s repository back on the repo list', () => {
    terminals.adoptTerminal({
      name: 'kirby-term-agent-4d5e6f',
      kind: 'agent',
      path: '/home/dev/other',
    });
    expect(state.recents).toEqual(['/home/dev/other']);
    expect(terminals.listTerminals(HOME)[0].repo).toBe('/home/dev/other');
  });
});

describe('listTerminals', () => {
  it('reports every terminal, running or not, whatever repository is open', () => {
    const a = terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/kirby' },
      HOME
    );
    const b = terminals.launchTerminal({ kind: 'shell', cwd: '/tmp' }, HOME);
    state.alive.delete(b.name); // the shell exited on its own
    expect(terminals.listTerminals(HOME)).toEqual([
      expect.objectContaining({ name: a.name, running: true }),
      expect.objectContaining({ name: b.name, running: false }),
    ]);
  });
});

/** The process behind `name` ends: the registry marks its entry exited
 *  and every exit subscriber hears about it, in the order they
 *  subscribed. The entry stays until something releases it. */
function endProcess(name: string): void {
  const session = state.sessions.get(name);
  if (session) session.exited = true;
  state.alive.delete(name);
  for (const cb of [...(state.onExit.get(name) ?? [])]) cb(0);
}

// The tab closes by itself when its process ends — `exit` typed into a
// shell, an agent quitting, tmux ending the session — so the host must
// stop listing the terminal, or the strip would keep a tab open on a
// process that is gone. Everything held for it goes with it: the
// relay buffer, and the registry tombstone nothing can view any more.
describe('a terminal whose process ended', () => {
  it('is no longer listed, and its buffer and registry entry are released', () => {
    const { name } = terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    state.onData.get(name)?.('$ exit\r\n');
    endProcess(name);
    expect(terminals.listTerminals(HOME)).toEqual([]);
    expect(terminals.terminalBuffer(name)).toBeUndefined();
    expect(terminals.isTerminal(name)).toBe(false);
    expect(state.released).toEqual([name]);
    // Released, never killed: on tmux a kill would reach the session,
    // and the client can exit while the session lives on.
    expect(state.killed).toEqual([]);
  });

  it('applies to an agent terminal as much as a shell', () => {
    const { name } = terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    endProcess(name);
    expect(terminals.listTerminals(HOME)).toEqual([]);
    expect(terminals.agentTerminalNames()).toEqual([]);
  });

  // A terminal the user closed was killed and forgotten already; the
  // exit that follows the kill must not release anything twice, or
  // touch a terminal that has since been opened under the same name.
  it('does nothing for a terminal that was already killed', () => {
    const { name } = terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    const exits = state.onExit.get(name) ?? [];
    terminals.killTerminal(name);
    for (const cb of exits) cb(0);
    expect(state.released).toEqual([]);
  });

  // Re-adopting a terminal (the user detached from inside tmux, and
  // discovery found the session still running) respawns under the same
  // name. The old client's exit lands after the respawn, and must not
  // drop the terminal the new client is attached to.
  it('keeps a terminal that was respawned under the same name', () => {
    terminals.adoptTerminal({
      name: 'kirby-term-shell-1a2b3c',
      kind: 'shell',
      path: '/x',
    });
    const oldExits = [...(state.onExit.get('kirby-term-shell-1a2b3c') ?? [])];
    terminals.adoptTerminal({
      name: 'kirby-term-shell-1a2b3c',
      kind: 'shell',
      path: '/x',
    });
    for (const cb of oldExits) cb(0);
    expect(terminals.listTerminals(HOME)).toHaveLength(1);
    expect(state.released).toEqual([]);
  });
});

describe('killTerminal', () => {
  it('kills the session and forgets the terminal', () => {
    const { name } = terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    terminals.killTerminal(name);
    expect(state.killed).toEqual([name]);
    expect(terminals.listTerminals(HOME)).toEqual([]);
    expect(terminals.terminalBuffer(name)).toBeUndefined();
  });

  it('is a no-op for a name it never launched', () => {
    terminals.killTerminal('kirby-term-shell-nope');
    expect(state.killed).toEqual([]);
  });
});

// getSessionActivity folds this into the same working-agent spinner a
// worktree agent gets. A shell animates on whatever the user types —
// `ls`, a build — with no agent behind it, so only the `agent` kind may
// reach that spinner.
describe('agentTerminalNames', () => {
  it('reports agent terminals and leaves shells out', () => {
    const shell = terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/notes' },
      HOME
    );
    const agent = terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    expect(terminals.agentTerminalNames()).toEqual([agent.name]);
    expect(terminals.agentTerminalNames()).not.toContain(shell.name);
  });

  it('is empty with no terminals at all', () => {
    expect(terminals.agentTerminalNames()).toEqual([]);
  });
});
