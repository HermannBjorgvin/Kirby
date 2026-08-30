import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

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

/** The environment that reaches the test's own tmux server — the same
 *  `TMUX_TMPDIR` the fixture spawns Kirby with. Empty is refused rather
 *  than defaulted: falling back to the shared socket would make these
 *  helpers act on a developer's real sessions. */
function socketEnv(tmuxTmpdir: string): NodeJS.ProcessEnv {
  if (!tmuxTmpdir) {
    throw new Error('tmux helpers need the test homeDir (TMUX_TMPDIR)');
  }
  return { ...process.env, TMUX_TMPDIR: tmuxTmpdir };
}

/** Session names on the test's tmux server. Empty list when no server is
 *  running — tmux exits non-zero for that, which is not an error here. */
export function listTmuxSessions(tmuxTmpdir: string): string[] {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: socketEnv(tmuxTmpdir),
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
        env: socketEnv(tmuxTmpdir),
      });
    } catch {
      /* already gone — best effort */
    }
  }
}
