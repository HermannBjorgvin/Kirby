# libs/terminal-tmux — tmux session backend

Optional backend over system tmux ≥ 2.0 (`is-tmux-available.ts` probes and
gives a platform install hint; the `=name:` exact option targets need 2.1, so
that is the effective floor — the probe is unchanged). It knows nothing about
Kirby: the caller supplies the session prefix and the `isQualified` seam.

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
- `spec.tags` become session user options, written only on the attach that
  creates the session (`tmuxHasSession` before the client is spawned decides);
  `status off` is set on every attach. `tmuxListSessionsDetailed(names)` reads
  them back in the one listing fork. The lib treats the names as opaque.
  Option targets are exact (`=name:`). Commands whose output is parsed pass
  `-u`: a non-UTF-8 client locale otherwise turns the listing's tabs into `_`.
