import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Put any tmux command this project's tests run onto a throwaway
 * server, before a single spec is imported.
 *
 * `libs/core` is where the real tmux calls live now —
 * `hasLiveTmuxSession` and `killPersistedTmuxSession` shell out through
 * `@kirby/terminal-tmux` — and they run whenever the resolved backend
 * is tmux, which an unset config now makes the default. Today no spec
 * reaches them with a probe that says "available", so nothing here has
 * ever touched a socket; that is an accident of the current tests
 * rather than a property of the code. One spec that stubs the probe as
 * available and exercises the kill path would otherwise run
 * `tmux kill-session -t kirby-<hash>-<branch>` against
 * `/tmp/tmux-$UID/default` — the developer's own agents.
 *
 * `TMUX_TMPDIR` picks the socket directory; `TMUX` names a socket path
 * outright and **wins**, so the second is removed rather than
 * overridden. The scratch server is never killed: it exits by itself
 * once its last session is gone.
 */
process.env.TMUX_TMPDIR = mkdtempSync(join(tmpdir(), 'kirby-core-tests-'));
delete process.env.TMUX;
delete process.env.TMUX_PANE;
