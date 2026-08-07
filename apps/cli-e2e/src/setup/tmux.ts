import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * Helpers for asserting on the tmux sessions Kirby creates.
 *
 * The test process and the Kirby-under-test share one tmux server (the
 * socket lives under /tmp/tmux-$UID, keyed by uid — not by HOME — so the
 * fixture's isolated HOME doesn't isolate tmux). That's what lets a test
 * observe Kirby's sessions from outside.
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

/** Session names on the tmux server. Empty list when no server is
 *  running — tmux exits non-zero for that, which is not an error here. */
export function listTmuxSessions(): string[] {
  try {
    return execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** The Kirby-created tmux session backing `branch`, if it exists. */
export function findKirbySessionFor(branch: string): string | undefined {
  return listTmuxSessions().find(
    (name) => name.startsWith(KIRBY_PREFIX) && name.endsWith(`-${branch}`)
  );
}

export function kirbySessionExists(branch: string): boolean {
  return findKirbySessionFor(branch) !== undefined;
}

/**
 * Teardown for tmux-backed tests. `killAll()` on Kirby exit deliberately
 * only *detaches*, so every tmux-backed test would otherwise leave a live
 * session (holding a fake-agent process) behind.
 *
 * Refuses any branch without the e2e marker — a guard against a future
 * caller passing something broader and wiping real sessions.
 */
export function cleanupTmuxSessions(branches: string[]): void {
  for (const branch of branches) {
    if (!branch.startsWith(E2E_BRANCH_PREFIX)) {
      throw new Error(
        `refusing to clean up tmux sessions for non-e2e branch "${branch}"`
      );
    }
    const name = findKirbySessionFor(branch);
    if (!name) continue;
    try {
      execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
    } catch {
      /* already gone — best effort */
    }
  }
}
