import type {
  SessionBackend,
  SessionBackendFactory,
  SessionSpec,
} from '@kirby/terminal';
import { PtySession } from './pty-session.js';

/**
 * Direct PTY backend factory. Spawns the spec's command inside a node-pty
 * pseudo-terminal. `dispose()` and `kill()` collapse to the same code path
 * because killing the local PTY *is* the only teardown — there is no
 * external session for this backend to leave behind.
 *
 * Backend-agnostic: this lib knows nothing about the application that is
 * using it, what the session is for, or how the name was constructed.
 */
export function createPtyBackendFactory(): SessionBackendFactory {
  return (spec: SessionSpec): SessionBackend =>
    new PtySession(spec.cmd === '' ? defaultShell(spec) : spec.cmd, spec.args, {
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: spec.env,
    });
}

/** What an empty `cmd` runs here: the user's shell. There is no tmux
 *  around to consult a `default-shell` option, so this is the terminal
 *  emulator's answer — `$SHELL`, from the session's own environment
 *  when it was given one, and `/bin/sh` when nothing says. */
function defaultShell(spec: SessionSpec): string {
  const env = spec.env ?? process.env;
  return env.SHELL || '/bin/sh';
}
