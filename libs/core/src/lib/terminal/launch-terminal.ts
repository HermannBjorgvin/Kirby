import type { AppConfig } from '@kirby/vcs-core';
import { spawnSession, type PtyEntry } from '../pty-registry.js';
import { launchSession } from '../session/launch-session.js';
import type { TerminalKind } from './terminal-name.js';

export interface TerminalLaunchParams {
  /** A name from `newTerminalSessionName`, or the one a scan found. */
  name: string;
  kind: TerminalKind;
  /** The directory the terminal runs in. Any directory: a repository
   *  root, a folder inside one, or nothing to do with git at all. */
  cwd: string;
  cols: number;
  rows: number;
  /** Read for the directory the terminal opens in, so a repository's
   *  own agent choice applies to an agent started at its root. */
  config: AppConfig;
}

/**
 * Start a terminal-tab session in a directory.
 *
 * A shell is the backend's own default shell — an empty command, which
 * `SessionSpec` defines as exactly that — so tmux picks its
 * `default-shell` and the PTY backend picks `$SHELL`, and no setting
 * has to name one. An agent is the session menu's plain "session"
 * launch and nothing more: the configured agent, no prompt, no review
 * guidance, resumed where the agent can. It goes through
 * {@link launchSession} rather than composing a command of its own, so
 * a change to how agents start reaches terminals for free.
 *
 * Re-running with a name tmux already holds reattaches (the backend's
 * `-A`), which is how a terminal that survived a restart comes back.
 */
export function launchTerminalSession(params: TerminalLaunchParams): PtyEntry {
  const { name, cwd, cols, rows, config } = params;
  if (params.kind === 'shell') {
    return spawnSession(name, '', [], cols, rows, cwd);
  }
  return launchSession({
    name,
    cwd,
    cols,
    rows,
    config,
    request: { intent: 'continue-or-blank' },
  });
}
