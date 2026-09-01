import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';

/**
 * Creating the things Kirby is supposed to notice on its own: a
 * worktree and an agent session made without the app being involved,
 * the way a second Kirby, a script or an operator at a shell would make
 * them.
 *
 * Every call takes the test's `homeDir`, because the fixture launches
 * the app with `TMUX_TMPDIR=<homeDir>`. A helper that omitted it would
 * act on the developer's own tmux server instead of the test's.
 */

const KIRBY_PREFIX = 'kirby-';

/** Marker on every branch these helpers create. Cleanup refuses to
 *  touch anything without it. */
const E2E_BRANCH_PREFIX = 'e2e-ext-';

export function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function uniqueExternalBranch(): string {
  return `${E2E_BRANCH_PREFIX}${randomBytes(3).toString('hex')}`;
}

function socketEnv(homeDir: string): NodeJS.ProcessEnv {
  if (!homeDir) {
    throw new Error('tmux helpers need the test homeDir (TMUX_TMPDIR)');
  }
  return { ...process.env, TMUX_TMPDIR: homeDir };
}

/**
 * The tmux session name Kirby composes for a session in this repo:
 * sha256 of the **git toplevel** (not the fixture's `repoPath`, which
 * can differ when tmpdir is a symlink), first 16 hex characters, with
 * tmux's forbidden characters replaced.
 */
export function kirbyTmuxName(repoPath: string, sessionName: string): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: repoPath,
    encoding: 'utf8',
  }).trim();
  const key = createHash('sha256').update(root).digest('hex').slice(0, 16);
  return `${KIRBY_PREFIX}${key}-${sessionName}`.replace(/[.:]/g, '-');
}

/** Add a worktree under the directory Kirby's resolver owns, with plain
 *  git. Returns its absolute path. */
export function addExternalWorktree(repoPath: string, branch: string): string {
  const path = join(repoPath, '.claude', 'worktrees', branch);
  execFileSync('git', ['worktree', 'add', '-b', branch, path], {
    cwd: repoPath,
    stdio: 'ignore',
  });
  return path;
}

/**
 * Start a detached tmux session under the name Kirby would use.
 *
 * `HOME` and `PATH` are pinned per session for the reason the backend
 * pins them: a tmux server keeps the environment it was started with,
 * so whichever process happened to start it would otherwise decide what
 * the agent sees.
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

/**
 * Kill the tmux sessions these helpers created. The app's own exit path
 * detaches rather than kills, so anything left running would outlive
 * the test.
 */
export function cleanupExternalSessions(
  repoPath: string,
  branches: string[],
  homeDir: string
): void {
  for (const branch of branches) {
    if (!branch.startsWith(E2E_BRANCH_PREFIX)) {
      throw new Error(
        `refusing to clean up tmux sessions for non-e2e branch "${branch}"`
      );
    }
    try {
      execFileSync(
        'tmux',
        ['kill-session', '-t', kirbyTmuxName(repoPath, branch)],
        { stdio: 'ignore', env: socketEnv(homeDir) }
      );
    } catch {
      /* already gone — best effort */
    }
  }
}
