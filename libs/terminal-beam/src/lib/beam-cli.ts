import { execFileSync } from 'node:child_process';
import { beamKillArgs } from './beam-args.js';

/** Result of running a beam subcommand. */
interface BeamRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Synchronous run of a beam subcommand. beam's non-interactive
 *  commands complete in one ssh round trip; blocking matches the
 *  pattern of the tmux backend's tmux-cli and keeps mocking simple. */
function runBeam(bin: string, args: string[]): BeamRunResult {
  try {
    const stdout = execFileSync(bin, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as Error & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      stdout:
        typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString() ?? '',
      stderr:
        typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString() ?? '',
      exitCode: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

/** Hard teardown of the session on its host. The worktree stays — full
 *  workspace removal is `beam kill --rm-worktree`, driven by the
 *  workspace layer, not the terminal backend. */
export function beamKillSession(bin: string, target: string): BeamRunResult {
  return runBeam(bin, beamKillArgs(target));
}
