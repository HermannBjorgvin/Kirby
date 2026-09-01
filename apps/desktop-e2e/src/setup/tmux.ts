import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

/**
 * Helpers for asserting on the tmux sessions the desktop app creates.
 *
 * Every call takes the test's `desktop.homeDir`: the fixture launches
 * the app with `TMUX_TMPDIR=<homeDir>`, so each test's tmux server
 * listens on a socket inside its own temp home rather than the shared
 * /tmp/tmux-$UID one.
 *
 * Kirby names its sessions `kirby-<projectKeyHash>-<branch>`. Tests
 * match on the branch suffix rather than recomputing the hash: the hash
 * is over the *git toplevel*, which can differ from the fixture's
 * `repoPath` when tmpdir is a symlink.
 */

const KIRBY_PREFIX = 'kirby-';

/** Basename prefix of the temp homes the fixture creates. The tmux
 *  socket lives inside one, and `socketEnv` refuses any other dir. */
const HOME_PREFIX = 'kirby-desktop-e2e-home-';

/** Spread into a test's `kirbyConfig` to leave `terminalBackend` out of
 *  the config file altogether — the state the tmux-when-detected
 *  default applies to. The fixture writes `'pty'` otherwise. */
export const UNSET_BACKEND: Record<string, unknown> = {
  terminalBackend: undefined,
};

export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** The socket dir a tmux helper is about to use, proven to be one of
 *  this run's throwaway homes.
 *
 *  Two things decide which tmux server a command reaches, and checking
 *  only the first is the trap that makes this worth asserting:
 *
 *    - `TMUX_TMPDIR` picks the directory the socket lives in. Its
 *      default is the OS temp dir, i.e. the developer's own
 *      `/tmp/tmux-$UID/default`.
 *    - `TMUX` names a socket path outright and **wins**. A suite
 *      started from inside a tmux session — which is how Kirby's own
 *      agents run — reaches the developer's server no matter what
 *      `TMUX_TMPDIR` says.
 *
 *  These helpers kill sessions by name pattern, and on that server the
 *  `kirby-` names are the user's running agents. So the socket is
 *  proven rather than assumed, and anything unproven throws.
 */
function socketEnv(tmuxTmpdir: string): NodeJS.ProcessEnv {
  if (!tmuxTmpdir) {
    throw new Error('tmux helpers need the test homeDir (TMUX_TMPDIR)');
  }
  if (resolve(tmuxTmpdir) === resolve(tmpdir())) {
    throw new Error(
      `refusing to use the default tmux socket dir (${tmuxTmpdir}) — ` +
        "that is the developer's own tmux server"
    );
  }
  if (!basename(tmuxTmpdir).startsWith(HOME_PREFIX)) {
    throw new Error(
      `${tmuxTmpdir} is not a ${HOME_PREFIX}* temp home created by the fixture`
    );
  }
  const env: NodeJS.ProcessEnv = { ...process.env, TMUX_TMPDIR: tmuxTmpdir };
  // Removed, not overridden: while it is set tmux ignores TMUX_TMPDIR.
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

/** Session names on the test's tmux server. Empty when no server is
 *  running — tmux exits non-zero for that, which is not an error here. */
export function listTmuxSessions(tmuxTmpdir: string): string[] {
  // Resolved *before* the try: `socketEnv` throws to stop a run that
  // would reach the wrong tmux server, and swallowing that here would
  // turn it into an empty list — which is exactly what the negative
  // assertions ("no kirby session exists") expect, so they would pass
  // while proving nothing, and teardown would silently reap nothing.
  const env = socketEnv(tmuxTmpdir);
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Kirby-created tmux session names on the test's server. */
export function kirbySessions(tmuxTmpdir: string): string[] {
  return listTmuxSessions(tmuxTmpdir).filter((n) => n.startsWith(KIRBY_PREFIX));
}

export function kirbySessionExists(
  branch: string,
  tmuxTmpdir: string
): boolean {
  return kirbySessions(tmuxTmpdir).some((n) => n.endsWith(`-${branch}`));
}

/**
 * Teardown for tmux-backed tests. Closing the app deliberately only
 * *detaches*, so a tmux-backed test would otherwise leave a live
 * session (holding a fake agent) behind on its own socket — which is
 * removed with the temp home, orphaning the server.
 */
export function killKirbySessions(tmuxTmpdir: string): void {
  const env = socketEnv(tmuxTmpdir);
  for (const name of kirbySessions(tmuxTmpdir)) {
    try {
      execFileSync('tmux', ['kill-session', '-t', name], {
        stdio: 'ignore',
        env,
      });
    } catch {
      /* already gone — best effort */
    }
  }
}
