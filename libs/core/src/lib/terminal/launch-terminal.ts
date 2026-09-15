import type { AppConfig } from '@kirby/vcs-core';
import { spawnSession, type NamedPtyEntry } from '../pty-registry.js';
import { launchSession } from '../session/launch-session.js';
import { ORCHESTRA_TAG } from '../session-identity.js';
import type { TerminalKind } from './terminal-name.js';

export interface TerminalLaunchParams {
  /** A name from `newTerminalSessionName`, or the one a scan found. */
  name: string;
  /** A new tab must allocate a session, even if its suggested name was taken. */
  fresh?: boolean;
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
 * The kind travels as the session-type tag: it is what tells the tmux
 * composition root that this spec is a terminal tab — identified by its
 * name — rather than a worktree session, and it is what a later scan
 * finds the terminal by. Re-running with a name tmux already holds
 * under that tag reattaches, which is how a terminal that survived a
 * restart comes back.
 */
export function launchTerminalSession(
  params: TerminalLaunchParams
): NamedPtyEntry {
  const { name, cwd, cols, rows, config } = params;
  const tags = { [ORCHESTRA_TAG.sessionType]: params.kind };
  const sessionOptions = { useBackendName: true, reuse: !params.fresh };
  if (params.kind === 'shell') {
    return spawnSession(
      name,
      '',
      [],
      cols,
      rows,
      cwd,
      undefined,
      tags,
      sessionOptions
    );
  }
  return launchSession({
    name,
    cwd,
    cols,
    rows,
    config,
    request: { intent: 'continue-or-blank' },
    tags,
    sessionOptions,
  });
}
