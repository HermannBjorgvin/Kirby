import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Put any tmux command this project's tests run onto a throwaway
 * server, before a single spec is imported.
 *
 * `libs/core` is where the real tmux calls live — the resolver lists
 * sessions, `killPersistedTmuxSession` kills one — and
 * `session-resolver.spec.ts` deliberately creates and kills real
 * sessions to prove the tag rules against a server. Without this it
 * would do that on `/tmp/tmux-$UID/default`, next to the developer's
 * own agents; the spec refuses to run unless the directory below is
 * in force.
 *
 * `TMUX_TMPDIR` picks the socket directory; `TMUX` names a socket path
 * outright and **wins**, so the second is removed rather than
 * overridden. The scratch server is never killed: it exits by itself
 * once its last session is gone.
 */
process.env.TMUX_TMPDIR = mkdtempSync(join(tmpdir(), 'kirby-core-tests-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;
