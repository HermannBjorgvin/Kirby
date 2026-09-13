# libs/core — @kirby/core

The shell-agnostic half: git, worktrees, PTY and session infrastructure,
config, providers, keybindings, the plan store, pure helpers. No react, ink,
electron or `@kirby/app-core` (lint-enforced). `src/plan.ts` is the
browser-safe entry (`@kirby/core/plan`); nothing under it may touch `node:`.
The reasoning behind each rule is in `docs/decisions.md`.

- **Terminal backend** (`session-backend.ts`): `resolveTerminalBackend` is the
  single answer. A stored `terminalBackend` wins; an absent key consults the
  tmux probe on every read and is never persisted. Await
  `probeTmuxAvailability()` before wiring the factory. A per-project value
  overrides the global one.
- **tmux persistence**: `new-session -A -s NAME` is the one launch path for
  first launch and resume. `-e HOME` / `-e PATH` plus seed additions per
  session, because a server keeps its birth env. `dispose()` detaches,
  `kill()` kills; `killAll()` on exit must dispose. `isQualifiedTmuxName`
  stops a complete name being prefixed a second time. `tmux-namespace.ts` is
  the only home of the `kirby-` literal.
- **Discovery** (`discovery/`): poll with pure `diffScans`; attach through
  `spawnSession` so `-A` resumes rather than duplicates. Polling is
  deliberate: tmux hooks are server-global and a control client resizes
  panes. Re-read
  `isSessionAlive` and `resolveTerminalBackend` per attach iteration. Retired
  names are passed in as `suppressed`. `observeTmuxSessions` answers the
  persistence question and the terminal listing in one fork, from the open
  repo's config.
- **Terminal sessions** (`terminal/terminal-name.ts`):
  `kirby-term-<shell|agent>-<id>`. An empty `cmd` means the backend's default
  shell. Agents go through `launchTerminalSession` → `launchSession`, never a
  second launch path. `discovery/live-worktree-sessions.ts` lists only names
  that compose exactly from a directory's repo and branch, remembers an origin
  while the directory exists, and never drops one because git failed to answer.
- **Session launch** (`session/`) resolves the worktree via `createWorktree`
  (directory-name keyed, tolerant of a switched branch), reads config from the
  repo root, and never respawns a live session. Force-remove is offered only
  for 'uncommitted changes' and 'not pushed to upstream'.
- **Plan** (`plan/`): items are value snapshots taken at add time.
  `composePlanPrompt` numbers items in `planRows` order. Checkout is
  three-state: inject into a live agent, respawn, or create the worktree and
  spawn.
- **Babysit** (`babysit/`): the baseline is what the agent was told, not what
  was last seen. Send after ten minutes of quiet or thirty at most, only while
  the agent has been idle thirty seconds (`idleFor`). Spawn only through
  `checkoutWorktree` (existing branch) with `seed`, never `continue-or-seed`.
  Every git call takes `cwd`; ask `live()` after each await. Fetches go through
  `sync/fetch-queue.ts`; the merge check is `sync/conflicts.ts` so badge and
  briefing agree. `onStatus` fires on transitions only. Timing overrides:
  `babysitTimingFromEnv`.
- **Pull request cache** (`pull-requests/pull-request-cache.ts`): shared per-repo provider reads at `prPollInterval`. Only the newest fetch
  commits; a credentials change clears all. `lookupPullRequest` distinguishes
  `gone` from `unknown`, and one absence is not an answer.
- **Git output streams** (`utils/git-run.ts`): `runGit` spawns, returns what
  arrived plus `truncated`, rejects only when git failed. `execFile` discards
  everything on overflow. `fetchWorktreeDiffText` (`utils/worktree-diff.ts`)
  bounds per file before diffing (`lstat` bytes, churn lines, a rename
  excludes both paths) and trims overruns at a file boundary; the PR path
  keeps every file. Untracked files are assembled by hand, never `git add -N`,
  and symlinks render as mode-120000 patches. Git-backed cases live in
  `worktree-diff.integration.spec.ts`.
- **Sync** (`sync/`): `sweepMergedBranches`, conflict counts. `asyncOps.run`
  never rejects; errors go through `setOperationErrorHandler`.
- `keybindings/registry.ts` is the action catalog and carries a 900-line
  ceiling on purpose. Presets: Normie, Vim.
- No recursive `fs.watch` over a checkout; `node_modules` alone exhausts the
  inotify default.
