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
    new PtySession(spec.cmd, spec.args, {
      cols: spec.cols,
      rows: spec.rows,
      cwd: spec.cwd,
      env: spec.env,
    });
}
