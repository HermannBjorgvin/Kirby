# libs/terminal-tmux — tmux session backend

Optional backend over system tmux ≥ 2.0 (`is-tmux-available.ts` probes and
gives a platform install hint). It knows nothing about Kirby: the caller
supplies the session prefix and the `isQualified` seam.

- `vitest.setup.ts` pins a scratch socket dir (`TMUX_TMPDIR`) and drops
  `$TMUX` before any spec loads; `assertScratchTmuxSocket` fails the run if
  either is lost. `$TMUX` names a socket outright and beats `TMUX_TMPDIR`, so
  a suite started inside a tmux session (how Kirby's own agents run) otherwise
  reaches the developer's server, where the `kirby-*` names are their live
  agents and these suites kill by name pattern.
- Never `tmux kill-server`. A scratch server exits with its last session.
- `-e HOME` / `-e PATH` per session needs tmux ≥ 3.2; a server keeps the env
  it was started with, and a stale server on the default socket otherwise
  kills every agent at launch. `attach-session -f ignore-size` also needs 3.2,
  above the floor.
- `sanitize-tmux-session-name.ts`: `.` and `:` become `-`, with a length cap.
  Terminal names (`kirby-term-…`) are shaped to pass it unchanged.
- `spec.tags` become session user options, set with the status bar once the
  session exists; `tmuxListSessionsDetailed(names)` reads them back in the one
  listing fork. The lib treats the names as opaque. Option targets are exact
  (`=name:`). A non-UTF-8 client locale turns the listing's tabs into `_`.
