# libs/terminal-tmux — tmux session backend

Optional backend over system tmux ≥ 2.0 (`is-tmux-available.ts` probes and
gives a platform install hint; the `=name:` exact targets need 2.1, so that
is the effective floor — the probe is unchanged). It knows nothing about
Kirby: the caller supplies three callbacks (`resolve`, `label`, `tags`) and
the lib never parses a session name.

- `vitest.setup.ts` pins a scratch socket dir (`TMUX_TMPDIR`) and drops
  `$TMUX` before any spec loads; `assertScratchTmuxSocket` fails the run if
  either is lost. `$TMUX` names a socket outright and beats `TMUX_TMPDIR`, so
  a suite started inside a tmux session (how Kirby's own agents run) otherwise
  reaches the developer's server, where the sessions are their live agents
  and these suites create and kill by name.
- Never `tmux kill-server`. A scratch server exits with its last session.
- Creation protocol (`tmux-backend.ts`): `resolve(spec)` names an existing
  session → `attach-session -t '=name:'`. Otherwise `label(spec)` is
  sanitized, the first candidate the server does not hold (`name`, `name-2`,
  …; `has-session`, then `new-session -d`, a "duplicate session" race moves
  on) is created detached, `tags(spec)` are written as session user options,
  and only then does the client attach. There is no `new-session -A` and no
  post-hoc retry: everything is on the session before a client can see it.
  `status off` is set on every attach; tags never are.
- `-e HOME` / `-e PATH` per session needs tmux ≥ 3.2; a server keeps the env
  it was started with, and a stale server on the default socket otherwise
  kills every agent at launch. `attach-session -f ignore-size` also needs 3.2,
  above the floor.
- `sanitize-tmux-session-name.ts`: `.` and `:` become `-`, with a 200-char
  cap and a 4-hex hash tail. The caller's label builder applies the same cap.
- `has-session`, `kill-session`, `attach-session` and option targets are all
  exact (`=name:`): a bare `-t name` is a prefix match once `name` is gone.
  `tmuxListSessionsDetailed(names)` reads `#{session_name}`,
  `#{session_created}`, the asked-for options and `#{session_path}` in one
  fork. Commands whose output is parsed pass `-u`: a non-UTF-8 client locale
  otherwise turns the listing's tabs into `_`.
