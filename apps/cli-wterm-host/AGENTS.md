# apps/cli-wterm-host — PTY-to-browser bridge for the TUI e2e suite

Node HTTP + WS server plus a `@wterm/dom` browser client. `build.mjs` builds
both in one esbuild script to avoid competing output-directory cleanup.

- `POST /spawn` kills any existing PTY, clears the buffer and spawns Kirby.
  `POST /kill` kills it. `WS /pty` replays a ~2 MB ring buffer on connect,
  then streams. A client that connects with no prior `/spawn` gets a
  dev-default tempdir, so `npx nx serve cli-wterm-host` plus a browser works.
- PTY lifetime is **not** coupled to WS lifetime: automated browsers close a
  socket with 1001 within ~100 ms of opening it. The client reconnects after
  200 ms and the replay restores the screen.
- `spawnKirby` strips `CI`, `CONTINUOUS_INTEGRATION` and `GITHUB_ACTIONS`
  (Ink paints nothing under them) and `$TMUX`, and gives each spawn a tmux
  socket inside its own HOME.
- One active PTY. Playwright runs with `workers: 1`; two worktrees running
  `cli-e2e` at once share port 5174 and clobber each other; set `PORT=<n>`.
  `GET /output` returns the raw ring buffer base64-encoded for byte assertions.
- `@wterm/dom` here is pinned to the exact version `apps/desktop` uses.
