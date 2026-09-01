import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Put every tmux command this project's tests run onto a throwaway
 * server, before a single spec is imported.
 *
 * `tmux-cli.ts` and the backend shell out with `execFileSync`, which
 * inherits the test process's environment — so with nothing set here
 * the live suite talks to `/tmp/tmux-$UID/default`, the developer's own
 * tmux server. It would start one if none was running, and create,
 * find and kill sessions on it alongside the user's real work. On a
 * machine where Kirby's own agents are tmux sessions, that is the
 * user's running agents.
 *
 * Two variables decide the socket, and only setting one of them is the
 * trap:
 *
 *   • `TMUX_TMPDIR` picks the directory the socket lives in.
 *   • `TMUX` names a socket path outright, and **wins** — a tmux client
 *     started from inside a tmux session (which is how Kirby's own
 *     agents run) ignores `TMUX_TMPDIR` entirely.
 *
 * So the second is removed rather than overridden. The scratch server
 * is never killed: it exits by itself once its last session is gone,
 * and `kill-server` cannot be aimed safely enough to be worth using.
 */
const SCRATCH_SOCKET_DIR = mkdtempSync(join(tmpdir(), 'kirby-tmux-tests-'));

process.env.TMUX_TMPDIR = SCRATCH_SOCKET_DIR;
delete process.env.TMUX;
delete process.env.TMUX_PANE;

/**
 * Fail loudly if the socket a test is about to use is not the scratch
 * one. Call it from any suite that creates or kills real tmux sessions:
 * the point is that a lost environment variable stops the suite instead
 * of quietly redirecting it onto the developer's server, where a
 * kill-by-name would take out their agents.
 */
export function assertScratchTmuxSocket(): void {
  if (process.env.TMUX) {
    throw new Error(
      '$TMUX is set — tmux would use that socket and ignore TMUX_TMPDIR. ' +
        'Refusing to run tmux commands against a real session.'
    );
  }
  if (process.env.TMUX_TMPDIR !== SCRATCH_SOCKET_DIR) {
    throw new Error(
      `TMUX_TMPDIR is ${
        process.env.TMUX_TMPDIR ?? '(unset)'
      }, not this run's scratch dir ${SCRATCH_SOCKET_DIR}.`
    );
  }
}
