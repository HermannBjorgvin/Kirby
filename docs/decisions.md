# Design decisions and learnings

The reasoning behind rules stated in the root and per-area `AGENTS.md` files. Grep for the rule when a nested file points here.

- **ANSI passthrough works:** TerminalEmulator (@xterm/headless) renders ANSI output which Ink `<Text>` passes directly to the terminal. Colors, bold, underline all render correctly.
- **Input forwarding works:** Raw stdin → PTY write round-trip is responsive enough for interactive use. Mouse tracking and scrollback navigation are supported.
- **NX workspace uses `apps/*` + `libs/*`** (not default `packages/*`). Workspaces configured in root package.json.
- **`npx nx sync`** may be needed when adding cross-library dependencies (e.g. worktree-manager importing terminal).
- **A fresh git worktree needs its own `npm ci`.** Git worktrees carry
  no untracked files, so a new one has no dependencies at all, and until
  it does, `nx` resolves the _other_ checkout's libs and you are testing
  code you did not change. Run `npm ci` in the worktree (it takes a few
  minutes; background it). Do not hardlink-copy `node_modules` from
  another checkout: npm keeps version-conflicting deps in _per-workspace_
  `node_modules` outside the root (`libs/review-comments/node_modules`,
  `apps/desktop/node_modules`), and missing those makes `tsc` report one
  `TS7016` that cascades into a dozen `TS6305`s, which reads as a broken
  library rather than a missing dependency. Verify the worktree with a
  typecheck before changing anything in it.
- **`TSX_TSCONFIG_PATH`:** The serve target sets this env var so tsx picks up `jsx: "react-jsx"` from `tsconfig.app.json`. Without it, tsx defaults to classic JSX transform and requires `import React`.
- **Ink disables its interactive TTY renderer when CI env vars are set.** `CI=true` / `CONTINUOUS_INTEGRATION` / `GITHUB_ACTIONS` all trigger it. If you spawn Kirby from a process that inherits those (e.g. Playwright's `webServer` on GitHub Actions or locally via `CI=1 npx …`), Kirby paints **nothing** — every `getByText` times out. Always strip those three vars in the env passed to the spawned PTY (see `cli-wterm-host/src/main.ts:spawnKirby`). Cost us three CI rounds chasing a phantom WS lifecycle bug before the actual cause was found.
- **Browsers under automation can close a WS with code 1001 ("Going Away") within ~100ms of opening it.** Don't couple PTY lifetime to WS lifetime in the host — the wterm host keeps the PTY alive across WS disconnects and buffers recent output (ring buffer, ~2MB) so a reconnecting client replays the terminal state. Client has a 200ms auto-reconnect on close.
- **NX inline config vs `project.json`:** our apps (`cli`, `cli-wterm-host`, `cli-e2e`) all use inline `"nx": { "name": "...", "targets": {...} }` in `package.json`. Generators default to this in recent Nx, and it keeps the project definition next to its deps. `cli-e2e` defines its `e2e` and `e2e:integration` targets explicitly rather than relying on `@nx/playwright/plugin` inference — we removed that plugin from `nx.json` because (a) we're the only Playwright project and (b) explicit config is easier to reason about (e.g. `e2e` running `playwright test --grep-invert @integration`).
- **Avoid nested platform-split build targets.** Original `cli-wterm-host` had `build-server` (node, `@nx/esbuild`) + `build-client` (browser, custom script) + `build` (noop) with `dependsOn` ordering to work around `@nx/esbuild`'s output-path cleaning. One `build.mjs` running both esbuild invocations is simpler and avoids the ordering bug.
- **Playwright `outputDir` + Nx `outputs` must agree** or nx caching works with stale artifacts. We pin `outputDir: './test-output/playwright/output'` and set matching `outputs` in the `e2e` target.
- **Pluggable terminal backend.** `libs/terminal` only owns the `SessionBackend` interface and the xterm renderer; `libs/terminal-pty` and `libs/terminal-tmux` are interchangeable backends both implementing that interface. `libs/core/src/lib/session-backend.ts` is the _only_ place the literal `'kirby-'` prefix appears — it composes `kirby-${projectKey(repoRoot)}-${branch}` for the tmux session name. The libs themselves know nothing about Kirby, branches, or projects. To add a future backend (SSH, Docker exec…), implement `SessionBackend` in a new lib and add a branch to `buildSessionBackendFactory`.
- **The terminal backend defaults to tmux when tmux is detected, and the default is never written to disk.** `resolveTerminalBackend` (`libs/core/src/lib/session-backend.ts`) is the single answer to "which backend": a stored `terminalBackend` wins in both directions, and only an absent key consults the probe. It resolves on every read rather than being persisted, so installing or removing tmux is honoured next launch and a `config.json` synced between machines pins nothing. Everything that used to branch on the raw config key goes through it — the factory, `isTmuxSessionPersisted`, `killPersistedTmuxSession`, the desktop's reattach-at-startup. The probe is therefore load-bearing at startup and must be **awaited before the session backend is wired**: the desktop's `whenReady` awaits it ahead of `openStartupRepo`, and firing it off instead strands a tmux machine on PTY for the whole run (`desktop-e2e/src/tmux-default-backend.test.ts` fails on exactly that mutation). The Settings field carries `defaultValue` so both shells display the resolved backend marked "(default)" and step their preset cycle off it; choosing a value explicitly still stores it. A per-project `terminalBackend` overrides the global one on read.

- **No test may touch the developer's tmux server, and one variable is not enough to guarantee it.** `TMUX_TMPDIR` picks the socket _directory_; `$TMUX` names a socket path outright and **wins**, so a suite started from inside a tmux session — which is how Kirby's own agents run — reaches the real server whatever `TMUX_TMPDIR` says. On that server the `kirby-` session names are the user's running agents, and these suites kill by name pattern. So: `libs/terminal-tmux/vitest.setup.ts` pins a scratch socket dir and drops `$TMUX` before any spec loads (the live spec had set neither and ran against the default socket by construction), and `assertScratchTmuxSocket` fails the run rather than letting a lost variable redirect it; both e2e `setup/tmux.ts` helpers prove their socket dir is a fixture-created temp home before they list or kill; the wterm host gives every spawn a socket inside its own HOME and drops `$TMUX` alongside the CI variables. Never run `tmux kill-server` — a scratch server exits on its own once its last session does.

- **Both e2e fixtures write `terminalBackend: 'pty'` under every test's config.** Not one test in either suite ever set the key, so with the tmux default they would all have flipped to tmux on any machine that has it — and app exit only _detaches_ a tmux session, so each one would leak a live agent. A test that wants the unconfigured state passes `terminalBackend: undefined`, which drops the key from the written file (`UNSET_BACKEND`). The desktop fixture also drops `KIRBY_VITE_URL`, which the dev orchestrator exports into every shell it starts and which points the suite at a dev server instead of the built app.

- **Kirby notices sessions it did not start.** A worktree or a tmux
  agent can appear while Kirby is running — a second instance, a script,
  or an operator running `git worktree add … && tmux new-session -d -s
kirby-<projectKey>-<branch> …`. `startSessionDiscovery`
  (`libs/core/src/lib/discovery/`) scans every 4s, diffs against the
  previous observation (`diffScans`, pure) and attaches through the
  normal `spawnSession` path, so tmux's `new-session -A` resumes the
  running agent instead of starting a second one. Both shells subscribe
  to the one scanner: the TUI from `useSessionManager`, the desktop from
  `host/services/discovery.ts` (which pushes `kirby/sidebar/discovered`
  so the renderer's query cache refetches). It replaced the desktop's
  `restorePersistedSessions` — the first scan does that job — so there is
  no separate restore path any more. **Polling was chosen deliberately**:
  a scan is two forks and ~5.5ms (measured), flat in worktree count
  because `listPersistedTmuxSessions` asks about the whole set in one
  `tmux list-sessions`. tmux hooks are per-server global state that two
  Kirby instances overwrite for each other, and a `tmux -C` control
  client participates in window sizing — it would resize the user's agent
  panes, and `attach-session -f ignore-size` needs tmux 3.2, above the
  2.0 floor. A non-recursive `fs.watch` on the resolver's base directory
  only shortens latency; losing it costs nothing but speed. Two guards
  are load-bearing and each has a test that fails without it: the attach
  loop re-reads `isSessionAlive` per iteration (an earlier attach can
  take long enough for the user to launch that session, and handing a
  live one to `spawnSession` disposes the PTY behind the pane they are
  looking at) and re-reads `resolveTerminalBackend` (Settings can swap to
  PTY mid-loop, and its own guard sees an empty registry because nothing
  has attached yet). A failing attach is retried a few times, then
  retired — and a retired name is passed into `diffScans` as
  `suppressed`, because counting it as a change refreshed both shells
  every tick forever.
- **Tmux backend persistence.** Tmux is optional. When selected, the backend spawns `tmux new-session -A -s NAME -- CMD` via the local PTY — `-A` makes the call atomic + idempotent so first launch and resume-after-restart share one code path. **A tmux server keeps the env it was started with** and spawns every session command with it, so the backend pins `-e HOME/-e PATH` + the caller's seed additions per session (tmux ≥ 3.2) — without this, a stale server on the default socket (e.g. left by a test run with a temp HOME) silently kills every agent at launch, and seeded prompts never reach the command at all. E2e runs set `TMUX_TMPDIR` to their temp HOME so test servers can't squat on the user's default socket. `dispose()` detaches the local PTY only; the tmux session keeps running so the next Kirby launch reattaches. `kill()` (called when the user explicitly removes a worktree) runs `tmux kill-session` first. This means **`killAll()` on Kirby exit must call `dispose()`**, not `kill()` — otherwise the persistence benefit is lost.
- **Desktop uses native OS elements where they exist.** Application menu (`apps/desktop/src/main/menu.ts` → `Menu.setApplicationMenu`, commands reach the renderer via `onMenuCommand`), context menus (`window.kirby.showContextMenu` → `Menu.popup`), native dialogs/about box, optional native window frame (`desktop-prefs.json` → `nativeFrame`). Web-rendered menus are only for things the OS can't express (rich dialogs, command palette). VS Code is inspiration for the shell, not a template.
- **Desktop review flow mirrors the TUI.** Launching an agent on any PR item opens the same menu (session / review / review with instructions); `launchReviewAgent` creates the worktree if needed and seeds the agent with `buildReviewLaunchRequest` from app-core (shared with the TUI's session menu, so prompt + `kirby util add-comment` guidance are identical). Agent drafts live in `~/.kirby/reviews/pr-<id>/comments.json`; the desktop polls them (`useDraftComments`), renders `DraftCard`s at their anchor in the diff, and posts through `@kirby/review-comments` `postReviewComments` (same poster as the TUI). A PR tab is a review workspace (`components/review/PrWorkspace.tsx`): a persistent, collapsible left rail (Agent · Files · Comments) beside one content pane that swaps between the diff and the agent terminal. The rail owns Launch/Stop; selecting a file or comment shows the diff (`DiffPane` — meta strip + the Unified/Split/Wrap/Hide-resolved/post-drafts/comment-nav toolbar lives here, not in the tab header, so it's gone in terminal view); selecting Agent shows the terminal (kept mounted so scrollback survives). Launching an agent auto-selects the terminal once. When the agent has written draft comments, the rail shows a **Review ready** entry (severity breakdown) that opens `ReviewStepper` in the content pane — a guided walkthrough of the drafts in severity order, each with a code snippet (`SnippetView`) and Edit/Discard/Skip/Post (keyboard e/d/↵, arrows to move); posting advances to the next. `lib/diff/diff-model.ts` has `orderDraftsForReview`/`severityCounts`/`snippetAround` (tested). Terminal fit: `SessionTerminal` measures its pane and calls `WTerm.resize` on ready/visible/resize (autoResize alone latched a stale size until a window resize). Editor tabs are keyed by PR id (renderer `itemKey`), stable as a PR moves between sidebar kinds (launching an agent turns an orphan/review PR into a session row) so the open tab never orphans. The sidebar list and the tab strip are two stores that can disagree, and every tab bug so far has come from reconciling them in pieces — so there is exactly one reconciliation point: `Workspace` feeds the item list to `sync-items`, and `lib/tabs/tabs-model.ts` re-keys stale tabs, opens a tab per newly running agent (history in `autoOpened`, so a closed tab stays closed) and pins previews with a live agent, in one pure step. Add nothing to that seam from an effect. `apps/desktop/src/host/services/sidebar.ts` attaches the alive session name to PR items; comment markdown renders images host-fetched with provider auth and its paragraphs render as `<div>` (block images/skeletons can't nest in `<p>`); `ErrorBoundary` wraps each tab so one bad view can't blank the window.
- **The desktop tab strip spans repositories; the host still holds
  one.** Opening another repository leaves the previous one's tabs on
  the strip, prefixed with its directory name and set off by a group
  separator, so an agent running over there stays in sight. A tab
  therefore carries its `repo` and is identified by the pair — two
  checkouts share branch names, so `branch:main` alone is not an
  identity, and neither is a PTY session name (`autoOpened` is
  repo-qualified for the same reason). That `repo` is the **real
  path**: `openRepo` resolves every path a repository is opened by
  (`canonicalRepoPath` — the picker, the recents list,
  `KIRBY_START_DIR`, a foreign tab) and the recents list is read
  through the same resolution, because git names the real path
  everywhere else (the tmux prefix, a worktree's origin, the foreign
  listing) and a repository opened through a symlink was otherwise two
  on the strip once another was open. `sync-items` reconciles only the
  tabs of the repo it is handed; a foreign tab must never be re-keyed,
  pinned or collapsed by a poll about somewhere else, and
  `tabs.properties.spec.ts` asserts that as an invariant over arbitrary
  sequences. `TabsProvider` sits above the repo gate in `App.tsx` —
  `Workspace` is keyed by repo and remounts, so anything below it is
  destroyed on a switch. After a relaunch, agents left running in
  _other_ repositories get their tabs back too, with no state file:
  `listLiveWorktreeSessions` (core) reads every `kirby-*` session's
  tmux `session_path` and `describeWorktreePath` asks git for the
  worktree's real repo root and branch, the host's
  `listForeignSessions` drops the open repository's own (those come
  through the sidebar), and `sync-items`'s `foreign` pass opens a strip
  entry per agent in its repo group — repo, branch, title, nothing
  attached, no focus — so activating it switches there and that
  repository's own discovery attaches the agent. Only a session whose
  name is **exactly** what Kirby composes for its directory's
  repository and branch is listed: an orphan (the worktree checked out
  another branch mid-session) is left to its own repository's scanner,
  and a detached-HEAD worktree's agent is dropped host-side because
  the desktop attaches by branch and would open the repository and
  attach nothing. Describing a directory is three blocking git forks
  on the main process and the listing is polled, so an origin is
  remembered for as long as the directory exists and the name still
  composes from it — the name stops matching only on that checkout —
  never when git failed to answer (a transient `index.lock` would hide
  a session), and only for the paths tmux lists now; the recents list
  is written when the foreign set changes, not on every poll.

  **The workspace follows the active tab, not the other way round.**
  The host is single-repo by construction (`requireRepo`, the memoized
  repo root, `projectKey`-namespaced tmux names, the `ownSession`
  guard), so a foreign tab's content cannot be rendered while another
  repo is open: `useRepoFollowsTabs` opens that tab's repository
  instead, and the sidebar and status bar move with it, so "which repo
  am I in?" keeps one answer. The mirror direction is
  `repo-opened`, which brings the newly opened repo's own tab
  forward (the one it was last left on, per `lastActiveByRepo`) —
  without it the workspace you asked for opens onto a pane explaining
  that the active tab belongs to the one you left. The alternative,
  keying every host service by repo root so several are open at once,
  was not taken: it reaches into `@kirby/core`'s memoized state and the
  worktree resolver, and buys nothing the switch does not already do.
  What it costs is that a foreign tab shows no live agent state —
  `getSessionActivity` and `listSessions` answer for the open repo only
  — so the strip says an agent is _there_, not what it is doing.

  **A sidebar answer names the repository it describes, and the
  renderer drops the ones that are not its own.** The host answers
  every sidebar query for whichever repo it has open, and the renderer
  keys those answers by the repo _it_ has open; the two disagree while
  a switch is in flight — the host has moved on, the previous workspace
  is still mounted and polling — and an answer about the new repo
  reconciled into the old one's tabs made a tab stamped with the repo
  being left, named after a branch that exists only in the one being
  entered: a second tab under the other repo's name that opened it with
  nothing to show. `getSidebarSnapshot` stamps the rows with their
  `cwd` (recomputing when a switch lands between its awaits, since the
  worktrees are listed under one repo and the sessions judged under the
  other), and `loadSidebarModel` keeps the rows it had when the stamp
  is not the query's repo. `sidebar-answer-repo.test.ts` holds the
  window open by switching the host through the bridge alone.

  **A tab remembers its title.** A foreign tab's item is out of reach —
  that sidebar has no row for it — so `sync-items` stamps `title`
  beside `branch`, and `tabPresentation` reads item, stamp, branch, key
  in that order. In the desktop, an item with a pull request is named
  by its title (`itemTitle`), the branch moving to the row's detail
  line; the TUI still names rows by branch.

- **A terminal tab is a session bound to a directory, and tmux is its
  only record.** The desktop can open a plain shell or the configured
  agent in any directory (File > New Terminal…, the palette,
  Ctrl/Cmd+Shift+T: where — current repo, another from the recents
  list, or any folder through the OS picker — then what). There is
  **no state file** for these. The tmux name is
  `kirby-term-<shell|agent>-<id>` (`libs/core/src/lib/terminal/
terminal-name.ts`; shaped to pass `sanitizeTmuxSessionName`
  unchanged, several per directory allowed), the kind is parsed from
  the name, and the directory is tmux's own `#{session_path}` — the
  `-c` the backend passes to `new-session` — read by
  `tmuxListSessionsDetailed` in the one `list-sessions` fork discovery
  already makes (`observeTmuxSessions` answers the worktree-persistence
  question and the terminal listing together). Anything written to
  `~/.kirby` would have to be kept in step with a server that already
  holds the truth, and would be one more thing to reconcile on a
  machine where the file and the server disagree. A shell is spawned
  as an **empty `cmd`** — the `SessionSpec` contract for "the
  backend's default shell": tmux runs `default-shell`, the PTY backend
  `$SHELL` or `/bin/sh` — so no setting names one. An agent goes
  through `launchTerminalSession` → `launchSession` with the session
  menu's plain intent, never a second launch path. Which tab group a
  terminal sits in is **derived at read time from its directory**
  (`host/services/terminal-home.ts`: the directory is a repo root → that
  repo's group and it is put on the recents list; anything else,
  including a subfolder of a checkout, is repo-less — nothing walks
  up), so a terminal restored from tmux is grouped the same way one
  just opened is. The tmux factory takes an `isQualified` seam
  (`isQualifiedTmuxName`) so a complete name is never prefixed with the
  project key a second time — `-A` would otherwise create a session
  beside the one it meant to resume — and the `kirby-` literal lives in
  `tmux-namespace.ts` alone. The same seam is what lets a worktree
  session whose agent checked out another branch (the tmux name no
  longer matches any worktree) **surface as an agent terminal tab in
  its directory instead of vanishing**. On the strip a terminal tab is
  pinned, titled by its directory cut from the _front_
  (`truncateLeading`, so the tail that tells two directories apart
  stays), shows only its terminal, and rides along on the same
  `sync-items` dispatch as the sidebar reconciliation — one pure step,
  not a second effect — without ever moving focus: a restored terminal
  from another repository would otherwise switch the workspace at
  startup. The dialog's steps are radix `ToggleGroup`s (roving focus,
  arrows move without choosing, `loop`), and whether choosing moves
  focus on to the next step is read off the click's `detail` — zero
  for a keyboard-caused click — rather than a flag set on keydown,
  which a cancelled folder picker left armed. A repo-root terminal is foreign anywhere but its repo and
  follows like any foreign tab; a plain-folder one belongs to nobody
  (`tabHome` is null) and activating it switches nothing. Closing a
  terminal tab always confirms and **kills** the session on both
  backends; quitting only detaches, so tmux terminals come back. When
  the process behind a terminal tab ends on its own — `exit` in the
  shell, the agent quitting, a tmux session killed from outside — the
  host drops it from `listTerminals` on the client PTY's exit
  (`watchForEnd`, releasing the relay buffer and the registry tombstone
  without a kill) and the relay's exit event reaches the renderer,
  whose `terminal-ended` closes the tab **by name, at once** rather
  than on the next poll, whether or not a listing ever named it (a
  process that died before the first listing would otherwise leave a
  tab whose close asks to end nothing); the reducer's `dropEnded` still
  closes any terminal tab a _defined_ listing does not name, with the
  user's close-focus rules, and an `undefined` listing is "not asked
  yet" and closes nothing. "At once" depends on every exit listener
  running: the host's handler releases the session, which detaches an
  earlier listener, and `PtySession` walks a **snapshot** of its
  listeners because iterating the live array starved the relay's
  broadcast. A tmux client that exits while its session lives on — the
  user pressed the detach key inside the terminal — is **not** an end:
  `watchForEnd` asks `isTmuxSessionPersisted` and reattaches under the
  same name at the client's grid with the output sequence carried, and
  the relay reports no exit for an entry that has been replaced (a
  released one still is), so the tab neither closes nor comes back
  unfocused a scan later. Two
  e2e traps: zsh greets a fresh `HOME` with its first-user wizard, which
  eats the first keystroke, so the fixture seeds an empty `.zshrc`; and
  Playwright reads any array whose second element is an object as a
  `[value, options]` fixture tuple, so the fixture's `liveTerminals` is
  a record keyed by session name rather than a list. Discovery resolves
  the tmux backend from the **open repository's** config
  (`session-discovery.ts`'s `observe()`), so a repo pinned to a
  per-project `terminalBackend: 'pty'` override hides every tmux
  terminal — not just its own — for as long as it is the open one.
- **The plan is a cart, and both shells share it.** A pull request tab
  collects review comments — reviewer threads, general comments and the
  agent's own drafts — into a queue and hands the whole thing to one
  agent as a single prompt. The store, the comment snapshots and the
  composer are `@kirby/core`'s, the same ones the TUI drives; the
  renderer reaches them through `@kirby/core/plan`, a subpath that is
  browser-safe by construction (nothing under it touches `node:`), with
  its `useSyncExternalStore` binding at `@kirby/app-core/plan`. A plan
  item is a **value snapshot** taken at add-time, so resolving, editing
  or posting the underlying comment never changes what was queued.
  Ordering is the queue's, never the document's: `composePlanPrompt`
  numbers items in the same order `planRows` lists them, and
  `plan-model.spec.ts` asserts the two against each other rather than
  each on its own — disagreement means the user annotates "item 3" and
  the agent is told to fix a different comment. The prompt is composed
  in the renderer because the pane previews the exact text before
  sending; composing it again host-side is how a preview and a delivery
  drift apart. Checkout reuses core's three-state orchestration
  (inject into a live agent / respawn / create the worktree and spawn)
  and the desktop adds only its session bookkeeping. Adopting a spawned
  session carries the chunk `seq` forward across a respawn — a mounted
  terminal ignores chunks at or below the sequence its replay ended at,
  so numbering a restarted session from 1 again left the new agent
  looking dead in the very pane the restart came from.
- **Babysitting a pull request is core's; the shells start and stop
  it.** "Babysit pull request" on a desktop sidebar row hands the pull
  request to `startPrBabysitter` (`libs/core/src/lib/babysit/`), which
  polls CI, unresolved review threads and conflicts against the target
  every minute and briefs the agent in one message. Three rules are
  load-bearing and each has a test in `babysit-model.spec.ts`:
  the baseline is **what the agent was told**, not what was last seen
  (a thread that gained a reply is news again; a verdict on a new
  `headSha` is a new verdict even when it reads the same, so a second
  red after the agent pushed is reported; a first green build on its
  own is not, but green after a reported red is; a thread whose newest
  comment is the user's own — the agent posting as the user, or the
  user answering by hand — is not relayed; a conflict check that could
  not run says so in the prompt and is never news); a pending update is
  sent after ten minutes of **quiet**, or thirty minutes at most, so a
  reviewer's burst of comments is one interruption; and it is sent
  **only while the agent has been silent for thirty seconds**
  (`idleFor(name)` — the sidebar spinner's two-second idle is shorter
  than a tool call), typed into the session like a plan, or as the
  opening prompt of a session started with `seed` (never
  `continue-or-seed`, which drops the prompt whenever there is a
  conversation to continue) in the worktree when none is running. That
  spawn happens for any babysat pull request — babysitting is opt-in
  per row — but only when the branch resolves locally or on origin,
  and through `checkoutWorktree`, the worktree-manager variant that
  only checks out an existing branch: `createWorktree`'s `-b` fallback
  would put an agent to work on a branch invented off HEAD. Otherwise
  the update is held and the badge says why. A held or failed delivery
  leaves the baseline alone. Starting to babysit a pull request that
  already needs work therefore sends its first update within ten
  minutes.

  **Every git call names its repository.** The desktop switches
  repositories with `chdir` and a poll straddles several awaits, so
  `PrBabysitterOptions.cwd` is threaded into `refExists`,
  `checkoutWorktree`, the fetch and the merge check; the observation
  asks `live()` after each await and abandons the poll rather than run
  git once the watch is stopped or the shell has moved on. The
  expensive half — the provider's thread list and a fetch of both refs
  — runs every five minutes or when the cached list shows the
  unresolved count or the head moved. The fetch goes through core's
  per-repository fetch line (`sync/fetch-queue.ts`), which the sync
  pass's `git fetch --all` also waits in, so the two cannot collide on
  ref locks; a fetch of the same refs by name younger than the refresh
  interval is reused rather than repeated, except when the head moved
  — the refs would hold the commit the author just replaced (a
  `fetch --all` that succeeded says nothing about a branch: on a
  repository with no remote it succeeds having fetched nothing). The
  worktree checkout on the spawn path resolves its directory through
  the process-global worktree resolver, which is why the `live()`
  check immediately before it is load-bearing. The merge check
  runs every poll by the same predicate the sidebar badge uses
  (`sync/conflicts.ts`: `origin/<target>` against `origin/<source>`
  for a branch with a pull request, since the local branch may not be
  where the author pushed; `origin/<main>` against the local branch
  for one without), so the badge and the briefing cannot disagree.

  **The pull request itself comes from the shared cache.** The
  watcher reads its row through `lookupPullRequest` on core's pull
  request cache, which distinguishes `gone` from `unknown` (no
  provider, or a list that failed or never loaded — never taken for
  merged). One absence is not an answer either: GitHub's list is an
  eventually consistent search, so the watch stays `watching` with no
  error and ends on the second consecutive absence. The provider is a
  getter read per poll (`getProvider`), so a vendor switched in
  Settings reaches a watcher started under the previous one.

  **Status rides on the sidebar item; the shell is pushed to for two
  things only.** `onStatus` fires on transitions only — the phase, a hold, a
  delivery, an error appearing or clearing, the end — never for a poll
  that moved `lastPolledAt` alone; `status()` is current regardless.
  `buildSidebarItems` takes a `babysat` map beside `mergedBranches`
  and `conflictCounts` and sets `item.babysit`, so a row wears its
  badge from the model it already has. The desktop keeps babysitters
  per repository in memory (`host/services/babysit.ts`), sits one out
  while another repository is open rather than tearing it down,
  honours the foreign-session guard through `isForeignSession`,
  decorates `listSidebarItems` from `babysatStatuses`, stops the
  babysitter of a branch whose worktree is being removed (a watcher
  left behind would check the branch out again at its next update),
  and pushes `BabysitChangedEvent` only for `spawned` (an agent
  started: a row and a session the next poll would show late) and
  `ended` (the row is usually gone with it); the renderer invalidates
  the sidebar and sessions on those and reads everything else off the
  sidebar poll. `KIRBY_BABYSIT_DEBOUNCE_MS` / `KIRBY_BABYSIT_POLL_MS`
  shorten the cadence (`babysitTimingFromEnv`, applied by
  `startPrBabysitter` when the caller sets none, so any shell's tests
  get it); `babysit.test.ts` asserts on the prompt the fake agent was
  actually started with. The TUI does not offer it yet; the watcher
  takes no shell-specific dependency, so wiring it is a menu entry and
  a `paneSize`.

- **Desktop diffs are whole-file.** `fetchDiffText` uses `-U99999` so threads on untouched lines can be placed; the desktop viewer folds unchanged regions client-side (`lib/diff/diff-model.ts`, ±3 context, expandable gaps, thread anchors pinned) rather than asking git for hunks.
- **A PR is diffed against commits; a bare worktree against its working tree.** `fetchDiffText` compares two commits, which is what review threads anchor to — a PR tab must never start showing uncommitted scratch work. A worktree with no PR has nothing to anchor, so `PrWorkspace` switches to `fetchWorktreeDiffText` (`libs/core/src/lib/utils/worktree-diff.ts`): merge-base diff run **inside the worktree**, so the index and working tree count, plus hand-built patches for untracked files. Untracked files are assembled rather than obtained via `git add -N`, because writing to the index of a worktree an agent is using changes what its own `git status` and `git commit` see. It polls at 2s **only while the agent is running** — a recursive `fs.watch` over a checkout wants an inotify handle per directory and `node_modules` alone exhausts the Linux default.
- **Every git call behind a diff streams, and the worktree diff is
  bounded per file.** `-U99999` makes a patch as large as the files it
  touches, and `execFile` _discards everything it read_ when its buffer
  is exceeded — one generated file in a worktree and the tab had no
  diff at all, only "stdout maxBuffer length exceeded". `runGit`
  (`libs/core/src/lib/utils/git-run.ts`) spawns instead and treats its
  ceiling as a stop: it returns what arrived plus `truncated`, and only
  rejects when git itself failed. `fetchWorktreeDiffText` then decides
  what it can render _before_ the expensive diff runs — `git diff
--numstat -z` names the changed files, their churn and which git
  calls binary — and drops what it cannot show with an
  `:(exclude,literal)` pathspec, putting a one-line placeholder patch
  in its place, so one unrepresentable file costs the user that file
  and not the other forty. What "cannot show" means is bounded by what
  **git will emit**, not by the file, and each clause has a test
  because each was wrong first:

  - `maxFileBytes` (2 MB) is measured with `lstat`, so a symlink is
    sized as the link — git renders one as its target path, and
    following it sizes the link as whatever it points at.
  - `maxFileLines` (50k) bounds the churn, because a **deletion** has
    nothing left on disk to size and its whole-file patch is the whole
    file.
  - A rename excludes **both** paths: pathspecs are applied before
    rename detection, so naming only the destination brings the source
    back unpaired, as a whole-file deletion — bigger than what the
    bound was avoiding. A rename with no content change is never
    summarised: its patch is a header and nothing else.

  Untracked files (`untracked-diff.ts`) are sized before they are read
  rather than after, read at bounded concurrency, rendered as
  mode-120000 patches when they are symlinks (reading through one
  printed a file from _outside_ the repo as the agent's work), and stay
  `--exclude-standard`, so nothing git ignores reaches the viewer. An
  overrun of the overall ceiling is trimmed back to a file boundary
  (`completePatch`) — half a hunk parses as real lines. The pull
  request path streams and trims the same way but keeps every file: its
  comments anchor into the document under review, so dropping one hides
  what a reviewer was asked to read. The git-backed cases live in
  `worktree-diff.integration.spec.ts`, including the 56 MB file the old
  buffer died on.

- **The diff file tree's collapse state is a function of the delta,
  never of the poll.** A worktree tab refetches every two seconds while
  its agent runs and the parse happens off the main thread, so between
  two patches the tree is handed _no files at all_. Open/closed state
  living in each row died on that blank tick, which is how one file
  being written reopened every folder. It lives in `FileTree` now and
  is reconciled by `lib/diff/file-tree-model.ts`: a refresh opens the
  ancestors of files that are new or whose contents moved since the
  last snapshot and nothing else, an empty snapshot is never recorded,
  and an unchanged snapshot returns the same state object so a quiet
  poll does not even re-render. The comparison is a per-file
  `revision` (a hash of that file's added and removed lines, from
  `buildFileEntries`) — churn counts miss a line swapped for another of
  the same shape. Adjusted during render, not from an effect: the lint
  gate forbids `setState` in an effect, and this is React's own
  "adjusting state when a prop changes".
- **A terminal is told its grid for every session, not every resize.**
  A launch can only _estimate_ the pane, so the PTY starts on a guess
  and is corrected by the first resize wterm emits once it has measured
  itself. Restarting an agent in a pane that already holds a
  correctly-sized terminal moves nothing and emits nothing, so the new
  agent stayed on the guess — 79 columns in a 93-column pane — until
  the window was resized. `SessionTerminal` now sends
  `resizeSession` on every fit rather than only when wterm's own grid
  moved, and re-fits on an `epoch` prop carrying the session's
  `spawnedAt`: a session's _name_ survives a restart, that timestamp
  does not. The estimate is measured too — `paneTerminalGrid` stands a
  hidden `.wterm` up inside `[data-terminal-pane]` (the content pane
  the terminal will occupy) and reads the font and padding that will
  actually apply, replacing a fixed 0.6 of the whole tab left over from
  a layout where the review workspace split its pane. That fraction
  survives as the fallback for the one case with no pane to measure —
  the first launch on a branch with no worktree, where the checkout has
  not happened yet — because the host's own fallback is a fixed 120x40
  whatever the window size. The fake agent's
  `--print-size` reports the PTY grid with its pid, which is what lets
  a test tell one agent's report from the next one's when tmux repaints
  the screen instead of appending to it.
- **The PR row's status circle carries two axes, not one.** `prStatusIndicator` (`renderer/lib/sidebar/sidebar-model.ts`) decides three channels: **colour** is the worst thing standing in the way (red = CI failed or rejected, yellow = CI running or waiting for author, green = all approved, muted = anything else), **glyph** is whichever axis is more severe so the circle depicts what is actually holding the request up, and **filled** means nothing is outstanding at all. Colour is deliberately asymmetric — CI can escalate a row but never vouch for it, so a passing build on an unapproved request stays muted and green means people signed off. Approvals win a glyph tie, which is what stops a green tick appearing inside a red circle on a rejected request. The 4×4 grid is asserted whole in `sidebar/sidebar-model.spec.ts`: every bug here has been a cell nobody thought to check.
- **The two providers are not tested to the same depth — know which one
  you are changing.** Both implement `VcsProvider` (`libs/vcs/core`),
  but only one of them is exercised against a live server.

  |             | GitHub                                                                                                  | Azure DevOps                                                                          |
  | ----------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
  | id          | `github`                                                                                                | `azure-devops`                                                                        |
  | auth        | none stored — shells out to an authenticated `gh` (`authFields: []`)                                    | PAT under `vendorAuth['azure-devops'].pat`, sent as a Basic header (`client.ts`)      |
  | transport   | `execFile('gh', …)`, GraphQL and REST                                                                   | `fetch` to `dev.azure.com`, REST                                                      |
  | unit        | `provider.spec.ts`                                                                                      | `provider.spec.ts`, plus recorded anonymised `/statuses` responses in `__fixtures__/` |
  | offline e2e | yes — `desktop-e2e/src/setup/fake-gh.ts` puts a stand-in `gh` on PATH and serves whole pull requests    | **none**                                                                              |
  | live e2e    | yes — `@integration` in `cli-e2e` and `desktop-e2e`, against permanent fixture PRs, gated on `GH_TOKEN` | **none**                                                                              |

  So a GitHub regression is caught by CI; an Azure DevOps one is caught
  by a user. The Azure paths that have actually broken are recorded as
  fixtures rather than covered live (see the statuses entry below), and
  `desktop-e2e/src/settings.test.ts` uses an ADO PAT only to test secret
  handling, not the provider. If you touch `libs/vcs/azure-devops`,
  the recorded fixtures are the safety net — extend them rather than
  assuming the suite has you covered.

- **A sync cycle has a request budget, and Azure is why.** Azure has no
  batch endpoint for a pull request's status list or its comment
  threads, so a cycle used to cost **two requests per open pull
  request** — plus a third per row whenever the pipeline-runs listing
  came back truncated and every row it could not account for fell back
  to its own query. A hundred open pull requests was three hundred
  requests a minute against an organization Azure throttles as a whole,
  and the client spent its budget re-reading answers it already had and
  then got refused. Three things hold it down now, and
  `request-budget.spec.ts` asserts each of them so a change that
  quietly reinstates a per-row call fails there rather than on
  someone's account:

  - **What cannot have changed is not re-read.** `pr-details.ts`
    remembers the combined CI verdict against the **merge identity** —
    `lastMergeSourceCommit` _and_ `lastMergeTargetCommit`, because
    Azure builds the merge ref and a pull request is rebuilt when its
    target advances under it. While that identity is where the last
    cycle left it, a _settled_ verdict is still the verdict. A
    `pending` one is always re-read, and jumps the queue: CI in flight
    is the moment the badge is worth watching, and by age it would sort
    last. Comment counts are **not** pinned to the identity: a push
    does not change what people have said.
  - **Shown and remembered are different answers.** When the runs
    listing cannot account for a row, the status list — a request that
    was actually spent — is still the best thing to display, and is
    still not enough to remember. Conflating them broke it in both
    directions: remembering the status list alone showed a red pipeline
    as green, and discarding it showed "no CI" on every row of a
    repository whose token lacked `Build (read)`.
  - **Ordering is by when a row was last _read_, not by the age of its
    answer.** A read that established nothing otherwise leaves the row
    looking unread, so the same rows are picked every cycle forever and
    the rest never at all. For the same reason a memo is aged out
    rather than deleted — including by `forgetRepoDetails`, which
    refresh uses: deleting would blank every badge the budget cannot
    re-read, which on two hundred rows is most of them.
  - **Every cycle is bounded.** Rows read together expire together, so
    a TTL alone turns one quiet cycle into a request per row on the
    next — the shape a sliding-window limit refuses. `pr-cycle.ts`
    spends a budget of 25 reads of each kind on the rows that waited
    longest (ties on pull request id, so the tail cannot starve) and
    shows the last known answer for the rest. A repository with 500
    open pull requests costs a cycle no more than one with 50 and takes
    more cycles to come round.
  - **The runs fallback is capped, and absence means two things.** On a
    _complete_ page, a row missing from the listing genuinely has no
    build and is recorded `none`; on a _truncated_ one, a row left
    unresolved is **omitted from the map**, which the caller must read
    as "not looked up" and must not remember. A failed lookup is
    omitted for the same reason — a network error is not evidence that
    a repository has no CI.

  A quiet cycle over a hundred pull requests now costs one request: the
  list. A babysitter's thread reads go through the provider's throttle
  gate and TTL like any other but sit outside `planCycle`'s 25-read
  budget, bounded instead by the number of babysat rows. GitHub needs
  none of this — its search query returns the
  rollup and the comment counts with the list, which is also why it
  implements neither `forgetPullRequestCache` (what a refresh button
  means: forget the per-row answers, not the credentials) nor
  `resetCaches`.

- **The pull request list is cached once, in core, per repository.**
  `libs/core/src/lib/pull-requests/pull-request-cache.ts` is what
  every host-side reader of the list sits on — the sidebar model, the
  babysitters (one row each, every minute) and the sync loop's
  conflict counts, which need a branch's target — so however many
  readers there are, the provider is asked once per `prPollInterval`.
  It is created with a `resolveProvider(cwd)` callback and knows no
  shell; the desktop's instance lives in `host/services/pull-requests.ts`
  and `services/sidebar.ts` is a thin caller. The tab strip spans
  repositories and following a foreign tab opens its repository, so
  switching back and forth is normal: the cache, the in-flight map
  _and_ the fetch-sequence guard are keyed by cwd, bounded at eight
  with the least recently fetched evicted (a global seq guard retired
  a fetch that was going to answer correctly for the repo the user
  switched away from, which then had nothing cached on return). A
  reader never waits for the network unless it asks to: `cached` and
  `refreshInBackground` serve the sidebar, `readPullRequests` awaits
  for a refresh button and for `lookupPullRequest`. A failure keeps the
  last good list and is retried on the interval, not on every read.
  Only the newest fetch per repository commits; a credentials change
  drops every entry (`vendorAuth` is global) and retires every fetch in
  the air, and a reader that had joined one of those is handed the
  post-clear cache rather than the list the old credentials fetched.
  The TUI's `usePrData` still polls the provider through its own hook;
  it is the only reader in that process.
- **Azure PR statuses are a history, not a current state.** `GET /pullrequests/{id}/statuses` returns every status a check has ever posted, across every iteration — re-running appends rather than replaces. `deriveBuildStatus` therefore groups by `context` and counts only the newest entry per check (highest `iterationId`, then date, then `id`); reducing over the raw list made the first failure permanent, so a fixed pull request showed red until it merged and no refresh could clear it. `notApplicable` competes on recency and retracts its own check's earlier verdict, but casts no vote; a missing `state` means `notSet` (Azure omits the field for enum zero) and reads as queued. A recorded, anonymised response lives in `libs/vcs/azure-devops/src/lib/__fixtures__/` — record new ones by hitting the API with the PAT from `~/.kirby/config.json`, scrubbing org/repo names and the `createdBy` identity, and reading them with `readFileSync` in the spec so they stay data rather than joining the module graph. Note the badge only ever reflects `/statuses`: a repo whose CI runs through **branch-policy build validation** reports under `_apis/policy/evaluations` instead, which Kirby does not read.
- **The three `@wterm/*` packages move as one, and are pinned exactly.** `@wterm/react` declares `@wterm/dom` as an **exact** peer (`"0.3.4"`, not a range) and `@wterm/dom` pins `@wterm/core` the same way, so a caret on any of them lets npm take a newer one than its sibling peer-requires and the tree stops resolving. To upgrade, set the same exact version in **both** `apps/desktop/package.json` (`@wterm/dom`, `@wterm/react`) and `apps/cli-wterm-host/package.json` (`@wterm/dom`), then `npm install` and check `npm ls @wterm/dom @wterm/react @wterm/core` shows one deduped copy of each. Verify with `nx e2e cli-e2e` (the harness terminal), `nx e2e desktop-e2e` and `nx e2e:visual desktop-e2e` — the last is what catches a stylesheet change, at zero pixel tolerance. Releases have been roughly weekly, so this is worth doing periodically rather than once.
- **Take the terminal stylesheet from `@wterm/dom/css`, never `@wterm/react/css`.** The react one is a single `@import "../../dom/src/terminal.css"` — a relative path that resolves only while npm keeps the two packages physically adjacent. The moment anything else in the workspace wants the same `@wterm/dom` version, npm hoists it to the root and the renderer build fails to resolve the import. `@wterm/dom` publishes the identical file under its own `./css` entry, which package resolution finds wherever the package lands.
- **Pasted images reach the agent as a path.** wterm's paste handler reads `clipboardData.getData('text')` and returns when there is none, so an image on the clipboard silently went nowhere. `SessionTerminal` takes image pastes in the capture phase, the host writes them under the OS temp dir (`services/clipboard-image.ts`) and the path is typed into the PTY. The suffix comes from the host's own MIME table, never the renderer-supplied string. Text pastes still fall through to wterm, which brackets and sanitises them.
- **Optimistic worktree removal treats the two row kinds differently.** `applyPendingRemovals` (`renderer/lib/sidebar/sidebar-model.ts`) drops a `session` row outright — the row _is_ the worktree — but keeps a PR row and clears only its `sessionName`/`running`, because the pull request outlives its checkout and the refetch would put the row straight back. Hiding both was why removing a worktree from a PR row felt unresponsive.
- **Switching backends is gated to no-active-sessions.** `apps/cli/src/input-handlers.ts:canApplyFieldChange` blocks the `terminalBackend` toggle whenever `hasAnySession()` is true and refuses a switch to tmux when `getTmuxAvailability()` reports unavailable (with the install hint). Without this guard, sessions would be stranded on a stale backend factory. The desktop enforces the same guards host-side in `apps/desktop/src/host/services/settings.ts:updateSettingsFromView`.
- **Two shells over one core.** `@kirby/core` is the shell-agnostic half of the app — git, worktrees, PTY and session infrastructure, config, providers, keybindings, the plan store, pure helpers. The TUI and the desktop render over it; they decide what the user sees and how it is driven, and they own no sequences of git / filesystem / PTY / config / provider calls. `@kirby/app-core` is the React layer above core (contexts, hooks, headless controllers) and is imported only by shells that render with React. Three lint rules hold the shape, and each was verified by writing the violation and watching it fail: `scope:core` may not depend on `scope:app-core` (nx tag constraint in `eslint.config.mjs`); `libs/core` may not import react, react-dom, ink, electron or `@kirby/app-core`; and the desktop renderer may not import `@kirby/core` for its values, because it reaches `node:fs`. Neither barrel re-exports the other, so the layer a symbol comes from is visible at its import site. The plan store is the worked example of where the line falls: the store is in core, its `useSyncExternalStore` binding is in app-core.

- **Where a sequence lives is not yet settled everywhere — check before adding one.** The desktop host was forced into a backend by Electron's sandbox (no Node in the renderer, so everything crosses `host/contract.ts`); the TUI never was, so some of its equivalent logic still sits inside React hooks and is duplicated rather than shared. `openRepo` (desktop `host/services/repo.ts`) does what the TUI's `useSessionManager` mount does: `autoDetectProjectConfig`, `setWorktreeResolver(createTemplateResolver(worktreePath))` (reset when unset), `applySessionBackend(config)`; `main.ts` runs `probeTmuxAvailability()` once at startup. Worktree removal is written twice — the TUI's `performDelete` triple (kill session → remove worktree → delete branch) and desktop `host/services/worktrees.ts` — and the two have already diverged: only the desktop calls `killPersistedTmuxSession`, so with the tmux backend the TUI can delete a worktree out from under a persisted session. Session launch resolves the worktree via `createWorktree` (directory-name keyed, tolerant of a switched branch), reads config from the **repo root** (per-project config is cwd-hash keyed), and never respawns a live session. Force-remove is only offered for the TUI's two overridable safety reasons ('uncommitted changes', 'not pushed to upstream'). Draft posting is one comment per `postReviewComments` call so a mid-batch failure can't reset already-live comments back to draft. When you touch one of these, put the sequence in `@kirby/core` and have both shells call it, rather than adding a third copy.
