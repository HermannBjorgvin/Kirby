// Pure builders for beam CLI argv. No spawning here — everything is
// unit-testable as data.

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** POSIX single-quote escaping, the same rules beam itself uses. */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  if (SAFE.test(s)) return s;
  return "'" + s.replace(/'/g, `'"'"'`) + "'";
}

export function shellJoin(argv: string[]): string {
  return argv.map(shellQuote).join(' ');
}

export interface BeamNewOptions {
  /** beam target, `<host>:<session>` — the same string Kirby uses as the
   *  session's registry key. */
  target: string;
  /** Start directory on the host. */
  cwd?: string;
  /** Repo path on the host; with `branch`, beam prepares a worktree
   *  there before the session starts. */
  repo?: string;
  branch?: string;
  /** Agent argv. Runs on the host through a login shell (`sh -lc`) so
   *  the host's own PATH finds the agent binary — non-interactive
   *  ssh/tmux shells often never read it. */
  command?: string[];
}

/**
 * Argv for `beam new`: create-or-attach. beam ignores the directory,
 * worktree flags and command when the session already exists, which is
 * exactly what makes reattach-after-restart the same call as first
 * launch (the tmux `-A` behaviour, one level up).
 */
export function beamNewArgs(opts: BeamNewOptions): string[] {
  const args = ['new', opts.target];
  if (opts.cwd) args.push('-c', opts.cwd);
  if (opts.repo && opts.branch) {
    args.push('--repo', opts.repo, '--branch', opts.branch);
  }
  if (opts.command && opts.command.length > 0) {
    args.push('--', 'sh', '-lc', shellJoin(opts.command));
  }
  return args;
}

/** Argv for `beam kill`; with `rmWorktree` the recorded worktree goes too. */
export function beamKillArgs(target: string, rmWorktree = false): string[] {
  const args = ['kill', target];
  if (rmWorktree) args.push('--rm-worktree');
  return args;
}

/** Argv for the machine-readable session list. */
export function beamLsArgs(): string[] {
  return ['ls', '--json'];
}
