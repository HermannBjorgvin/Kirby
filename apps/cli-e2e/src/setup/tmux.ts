import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/**
 * Helpers for asserting on the tmux sessions Kirby creates.
 *
 * Every call takes the test's `kirby.homeDir`, because the fixture spawns
 * Kirby with `TMUX_TMPDIR=<homeDir>` — each test's tmux server therefore
 * listens on a socket inside its own temp home, not the shared
 * /tmp/tmux-$UID one. A helper that omitted it would query a different
 * (usually empty) server and report every session as missing.
 *
 * Kirby names its sessions `kirby-<projectKeyHash>-<branch>`. Tests match
 * on the branch suffix rather than recomputing the hash: the hash is over
 * the *git toplevel*, which can differ from the fixture's `repoPath` when
 * tmpdir is a symlink (macOS /tmp → /private/tmp).
 */

const KIRBY_PREFIX = 'kirby-';

/** Prefix for branches created by tmux e2e tests. Cleanup only ever
 *  touches sessions matching this, so a developer's real Kirby tmux
 *  sessions can't be caught in the blast radius. */
const E2E_BRANCH_PREFIX = 'e2e-tmux-';

/** Basename prefix of the temp homes the fixture creates. The tmux
 *  socket lives inside one, and `socketEnv` refuses any other dir. */
const HOME_PREFIX = 'kirby-e2e-web-home-';

/** Spread into a test's `kirbyConfig` to leave `terminalBackend` out of
 *  the config file altogether — the state the tmux-when-detected default
 *  applies to. The fixture writes `'pty'` otherwise. */
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

/** Unique, short, git-legal branch name carrying the e2e marker. */
export function uniqueTmuxBranch(): string {
  return `${E2E_BRANCH_PREFIX}${randomBytes(3).toString('hex')}`;
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

/** Session names on the test's tmux server. Empty list when no server is
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

/** The Kirby-created tmux session backing `branch`, if it exists. */
export function findKirbySessionFor(
  branch: string,
  tmuxTmpdir: string
): string | undefined {
  return listTmuxSessions(tmuxTmpdir).find(
    (name) => name.startsWith(KIRBY_PREFIX) && name.endsWith(`-${branch}`)
  );
}

export function kirbySessionExists(
  branch: string,
  tmuxTmpdir: string
): boolean {
  return findKirbySessionFor(branch, tmuxTmpdir) !== undefined;
}

/**
 * Teardown for tmux-backed tests. `killAll()` on Kirby exit deliberately
 * only *detaches*, so every tmux-backed test would otherwise leave a live
 * session (holding a fake-agent process) behind.
 *
 * Refuses any branch without the e2e marker — a guard against a future
 * caller passing something broader and wiping real sessions.
 */
export function cleanupTmuxSessions(
  branches: string[],
  tmuxTmpdir: string
): void {
  const env = socketEnv(tmuxTmpdir);
  for (const branch of branches) {
    if (!branch.startsWith(E2E_BRANCH_PREFIX)) {
      throw new Error(
        `refusing to clean up tmux sessions for non-e2e branch "${branch}"`
      );
    }
    const name = findKirbySessionFor(branch, tmuxTmpdir);
    if (!name) continue;
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

// ── Sessions created without Kirby ───────────────────────────────
//
// The other direction from the helpers above: instead of asserting on
// what Kirby made, these *make* the thing Kirby is supposed to notice —
// a worktree and a tmux session created the way a second Kirby, a
// script or an operator at a shell would create them.

/**
 * The tmux session name Kirby composes for a session in this repo.
 *
 * Unlike the assertions above, creating a session has to get the hash
 * exactly right, so it is derived the way Kirby derives it: sha256 of
 * the **git toplevel** (not the fixture's `repoPath`, which can differ
 * when tmpdir is a symlink), first 16 hex characters, with tmux's
 * forbidden characters replaced.
 */
export function kirbyTmuxName(repoPath: string, sessionName: string): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
  const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return `${KIRBY_PREFIX}${key}-${sessionName}`.replace(/[.:]/g, '-');
}

/**
 * Add a worktree under the directory Kirby's default resolver owns,
 * with plain git and no help from Kirby. Returns its absolute path.
 */
export function addExternalWorktree(repoPath: string, branch: string): string {
  const path = join(repoPath, '.claude', 'worktrees', branch);
  execFileSync('git', ['worktree', 'add', '-b', branch, path], {
    cwd: repoPath,
    stdio: 'ignore',
  });
  return path;
}

/**
 * Start a detached tmux session under the name Kirby would use, on the
 * test's own tmux server.
 *
 * `HOME` and `PATH` are pinned per session for the reason the backend
 * pins them: a tmux server keeps the environment it was started with
 * and spawns every session command with it, so whichever process
 * happened to start the server would otherwise decide what the agent
 * sees.
 */
export function startExternalTmuxSession(opts: {
  repoPath: string;
  homeDir: string;
  branch: string;
  worktreePath: string;
  command: string;
}): string {
  const name = kirbyTmuxName(opts.repoPath, opts.branch);
  execFileSync(
    'tmux',
    [
      'new-session',
      '-d',
      '-s',
      name,
      '-c',
      opts.worktreePath,
      '-x',
      '120',
      '-y',
      '40',
      '-e',
      `HOME=${opts.homeDir}`,
      '-e',
      `PATH=${process.env.PATH ?? ''}`,
      '--',
      '/bin/sh',
      '-c',
      opts.command,
    ],
    { stdio: 'ignore', env: socketEnv(opts.homeDir) }
  );
  return name;
}
