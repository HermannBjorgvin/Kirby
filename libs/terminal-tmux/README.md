# terminal-tmux

Persistent terminal transport for tmux 3.2+. `createTmuxBackend(spec, plan)`
prepares an explicit create, attach or restart operation, then embeds a tmux
client through `@kirby/terminal-pty`. Callers supply identity as opaque tags.

Hosted-process exit and local-client disconnect have separate lifetimes.
Disposal detaches; an explicit kill terminates the session. Desktop applications
can install an asynchronous preparer to create sessions in an isolated process.

- Build: `npx nx build @kirby/terminal-tmux`
- Tests: `npx nx test @kirby/terminal-tmux`

See [the transport rules](AGENTS.md) for lifecycle and test-isolation details.
