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
- **tmux identity**: names are labels, tags are identity.
  `session-identity.ts` owns the `@orchestra-*` tag names shared with
  Orchestra, the label builder (`<repo>-<branch>`, `<repo>-shell`,
  `<repo>-agent`; `/`, `.`, `:` → `-`, 200-char cap with a hash tail) and
  the matching rules; `session-resolver.ts` is the one `list-sessions` fork
  every attach, exists, kill, adopt and listing goes through; and
  `tmux-factory-options.ts` composes the backend's `resolve`/`label`/`tags`
  for the repo root, plus the `isTaken` probe it answers for tabs only.
  A session without `@orchestra-spawner` or
  `@orchestra-session-type` (or `@orchestra-repo` for a worktree) is foreign: never attached, killed, adopted or
  listed, whatever it is called. No tmux code may use `projectKey`. `-e HOME`
  / `-e PATH` plus seed additions per session, because a server keeps its
  birth env. `dispose()` detaches, `kill()` kills; `killAll()` on exit must
  dispose. See `docs/decisions.md`, "Session identity shared with Orchestra".
- **Discovery** (`discovery/`): poll with pure `diffScans`; attach through
  `spawnSession` so the backend resolves the running session by its tags
  rather than duplicating it. Polling is deliberate: tmux hooks are
  server-global and a control client resizes panes. Re-read `isSessionAlive`
  and `resolveTerminalBackend` per attach iteration. Retired names are passed
  in as `suppressed`. `observeTmuxSessions` answers the persistence question
  (a session tagged with the open root and a listed worktree's branch), the
  orphan question (tagged with the root, on no listed branch, not held here)
  and the terminal listing (by session type, wherever it runs) in one fork.
- **Terminal sessions** (`terminal/terminal-name.ts`): a tab is keyed by its
  actual backend name, allocated from `<repo>-shell`/`<repo>-agent` at spawn;
  `launchTerminalSession` declares the kind as the session-type tag, which
  is how the factory tells a tab from a worktree session. An empty `cmd`
  means the backend's default shell. Agents go through
  `launchTerminalSession` → `launchSession`, never a second launch path.
  `discovery/live-worktree-sessions.ts` lists tagged `worktree` sessions
  whose directory's HEAD is still on the tagged branch; there is no git
  fallback and no origin cache.
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
