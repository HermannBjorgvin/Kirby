import { exec as execCb, type ExecOptions } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

/** Default timeout for git commands (30s). */
const GIT_TIMEOUT_MS = 30_000;

/**
 * Environment variables that prevent git and SSH from prompting for
 * credentials interactively. Without these, a locked SSH agent (e.g.
 * 1Password) can cause SSH to open /dev/tty for a passphrase prompt,
 * which steals stdin from Kirby's TUI.
 */
export const GIT_NO_PROMPT_ENV = {
  GIT_TERMINAL_PROMPT: '0', // git: never prompt for credentials
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes', // ssh: never prompt on TTY
};

export function exec(
  command: string,
  options?: { encoding: BufferEncoding } & ExecOptions
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, {
    timeout: GIT_TIMEOUT_MS,
    ...options,
    env: { ...process.env, ...GIT_NO_PROMPT_ENV, ...options?.env },
  });
}

/**
 * Options for a git call made on behalf of a specific repository.
 * `cwd` is added only when given, so a caller that passes none runs
 * against the process's directory exactly as before.
 */
export function gitOptions(cwd?: string): {
  encoding: BufferEncoding;
  cwd?: string;
} {
  return cwd ? { encoding: 'utf8', cwd } : { encoding: 'utf8' };
}
