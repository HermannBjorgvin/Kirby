# Design decisions

Read the section relevant to the change. Area `AGENTS.md` files contain the
working rules; this document explains constraints that are easy to miss.

## Shared operations and entry points

Core owns sequences of git, filesystem, PTY, config and provider calls.
App-core supplies React bindings; shells own presentation. The desktop renderer
cannot use Node APIs and accesses core's plan through `@kirby/core/plan`.
Keep that entry browser-safe and the core/app-core barrels separate.

When changing shared behavior, compare both shells. Worktree removal is
implemented in the TUI's `performDelete` and desktop's `services/worktrees.ts`;
only the latter kills persisted tmux sessions. Consolidate that sequence in core
when changing it. Draft posting uses one comment per `postReviewComments` call,
so a partial failure cannot reset already-posted comments to drafts.

A fresh worktree needs its own `npm ci`: workspace links and nested dependencies
must resolve to that checkout. Copying only another checkout's root
`node_modules` misses per-workspace dependencies. Typecheck before code edits.
Nx targets may be inline in package manifests or inferred by plugins; inspect
resolved configuration with `npx nx show project <name> --json`.

## Terminal backends and isolation

`SessionBackend` separates terminal transport from Kirby. PTY and tmux backends
receive session names from core; `tmux-namespace.ts` owns the Kirby prefix.
`resolveTerminalBackend` honors project then global configuration, otherwise
uses the tmux probe. Do not persist the detected default: another machine may
have different capabilities. Await the probe before wiring the backend.

A backend switch requires no live sessions; selecting tmux requires a successful
probe. Both shells enforce this so sessions cannot retain an obsolete factory.

Tmux launch and resume share `new-session -A`. `dispose()` detaches the client;
`kill()` ends the session. Application shutdown must dispose, including
`killAll()`. A tmux server retains its original environment, so sessions receive
explicit HOME, PATH and seed variables. The `-e` options require tmux 3.2;
check compatibility when changing the older availability-probe floor.

Tests must isolate the socket and environment. `TMUX` names a socket directly
and overrides `TMUX_TMPDIR`: unset it, place the socket directory inside the
fixture HOME, and assert isolation before listing or killing sessions. Never
use `tmux kill-server`. Fixtures select PTY unless a test explicitly exercises
tmux or an unset backend. This prevents detached agents leaking after tests.

`list-sessions -F` output is tab-separated. A tmux client whose locale is not
UTF-8 rewrites control characters in that output to `_`, which folds every
column into the name, so `tmux-cli.ts` passes `-u` to every command whose
output it parses (`list-sessions -F`, `show-options`).

## Session tags shared with Orchestra

Kirby and Orchestra create and inspect the same `kirby-<projectKey>-<branch>`
tmux sessions. Everything either program records about a session is a tmux
session user option — a tag — on the session itself: `set-option -t '=<name>:'
@orchestra-x value` to write, `#{@orchestra-x}` in a format string or
`show-options -qv` to read. Tags die with the session; no file records them.
A value is a plain string without tabs, and an absent tag is unset, never a
sentinel. The names live in `libs/core/src/lib/tmux-namespace.ts` next to the
`kirby-` prefix; `libs/terminal-tmux` carries them as opaque `spec.tags` and
option-name arguments and knows neither `@orchestra-` nor `kirby-`. The
`=name:` exact target form needs tmux 2.1; the availability probe still
accepts 2.0.

Whichever program creates a session writes its provenance: `@orchestra-spawner`
(`kirby` or `orchestra`), `@orchestra-repo` (the symlink-resolved main checkout,
the string `projectKey` hashes) and `@orchestra-branch` (unsanitized; a
detached-HEAD worktree's directory name). Kirby sets them by wrapping the tmux
factory in the composition root (`session-provenance.ts`), where the repo root
is already known, so the PTY path forks nothing; the branch comes from the
worktree's HEAD file rather than a git fork. A qualified name — a terminal tab
or an orphaned worktree session being re-attached — is attached to, not created,
and is left as it is. The backend writes tags on the same retry path that turns
the status bar off, but only on the attach that creates the session: `-A`
attaching to an existing one — an Orchestra-spawned session that discovery
adopts — must not overwrite `@orchestra-spawner=orchestra` with `kirby`. The
trade-off is that a session created before this change never gains tags; it
keeps working through the git fallback below.

Discovery (`live-worktree-sessions.ts`) asks for `@orchestra-repo`,
`@orchestra-branch`, `@orchestra-agent`, `@orchestra-orchestrator` and
`@orchestra-last-report` in its one `list-sessions` fork and never uses
`list-sessions -f` (tmux 3.1; the floor is 2.0). A session carrying both repo
and branch has provenance: its repository is the tag, and its branch is read
from the worktree's HEAD file — which also says whether it is detached — so no
git is forked. `@orchestra-branch` records what the session was spawned under,
and a worktree that has since checked out another branch is still the orphan
case: the composed name no longer matches and the session is left out, as with
git. A session lacking either tag — created before the convention — falls back
to `describeWorktreePath`, through the same origins cache. The Orchestra-only
tags are passed along as optional `agent`, `orchestrator` and `lastReport`
fields; nothing in either shell displays them yet.

## Discovery and terminal lifecycle

Discovery polls tmux and worktrees, diffs observations with `diffScans`, and
attaches through `spawnSession`. Polling avoids server-global tmux hooks and
control clients that can resize panes. Recheck session liveness and the selected
backend after awaits: the user may launch a session or switch backends mid-scan.
Pass retired names as `suppressed` so they do not trigger a refresh every poll.

Foreign-session discovery accepts names that exactly match the directory's repo
and branch. Cache origins while their directories exist; a transient git error
is not evidence that an agent disappeared. Discovery uses the open repo's backend
configuration, including its per-project override.

Standalone terminal sessions use `kirby-term-<shell|agent>-<id>` and tmux's
`session_path`; no separate state file is needed. An empty command means the
backend's default shell. Agents use `launchTerminalSession` → `launchSession`.
Recognize qualified names to avoid prefixing them again. A worktree session whose
branch changed can appear as an agent terminal instead of disappearing.

Terminal grouping is derived from its directory: a repository root belongs to
that repo; other directories are repo-less. Restoring a terminal must not move
focus. Closing its tab kills the session; quitting Kirby detaches it.

Process exit closes a tab by session name immediately, even before the first
listing. A defined listing can remove missing terminals; `undefined` means no
answer yet. Iterate a snapshot of exit listeners because a listener can remove
another listener during notification. If only the tmux client detached and the
server session lives, reattach without reporting the terminal as ended.

Carry output sequence numbers across reattachment and respawn: a mounted
terminal ignores chunks older than its replay. Resize on every fit and whenever
`spawnedAt` changes, even if the session name and pane dimensions are unchanged.
`paneTerminalGrid` measures the actual terminal font and padding for launch size;
the first fit corrects any estimate made before the pane exists.

## Desktop repositories and tabs

The host serves one repository at a time; the tab strip can contain several.
Activating a foreign tab opens its repository through `useRepoFollowsTabs`.
Use canonical real paths for repository identity so symlinked paths cannot
produce duplicate tabs or disagree with git and tmux names.

`TabsProvider` lives above the repository gate because `Workspace` remounts on
switch. Keep one reconciliation step: `Workspace` sends `sync-items` to the pure
`tabs-model.ts` reducer. It handles stale identities, previews, new agents,
foreign sessions and terminals. Reconcile only the repo described by the update.
Agent auto-open history is repo-qualified; closing a tab must not reopen it on
an unchanged poll. Store titles on tabs because foreign items may be unavailable.

Sidebar snapshots carry their repository identity. Drop mismatched answers in
the renderer, and recheck identity between host awaits, to prevent rows from a
new repository entering the previous repository's tab state.

Use native menus and dialogs where the OS supports the interaction. The review
workspace has a navigation rail and one content pane; keep the terminal mounted
when switching to the diff so scrollback survives. The diff owns its toolbar.
Each tab has an ErrorBoundary. Markdown paragraphs render as `div` when they may
contain block images; the host fetches protected images with provider auth.

Optimistic removal drops a session row but retains a PR row with its session
fields cleared: the PR outlives its checkout. Status indicators combine CI and
review status; CI can worsen the result, but passing CI does not imply approval.
The status matrix and tab invariants are covered by model tests.

## Plans and babysitting

Plan items are value snapshots taken when queued. Later comment edits or
resolution must not change them. `composePlanPrompt` follows `planRows` order so
item numbers match what the user sees. The renderer composes the delivered text
because it previews that exact prompt. Checkout injects into a live agent,
respawns an ended one, or creates a worktree and launches an agent.

The babysitter baseline is what the agent was told, not the latest observation.
Hold or delivery failures leave it unchanged. A new head or thread reply can be
news; the user's own latest comment is not relayed. Recovery from a reported CI
failure is news; an initial green result alone is not. An unavailable conflict
check is reported as unavailable, never interpreted as a clean result.

Batch updates after ten minutes of quiet or thirty minutes maximum, and deliver
only after the agent has been idle for thirty seconds. Start agents with `seed`,
not `continue-or-seed`, which may discard the prompt. Use `checkoutWorktree` for
an existing branch: inventing one from HEAD would send work to the wrong commit.

Pass `cwd` to every git operation and check `live()` after awaits. Serialize
fetches through `sync/fetch-queue.ts`; invalidate reused refs when the head moves.
Use `sync/conflicts.ts` for both the badge and briefing. The worktree resolver is
process-global, so check liveness immediately before checkout as well.

Babysitters read the shared PR cache, distinguish unknown from gone, and require
consecutive absences before ending a watch. Resolve the provider per poll so
settings changes take effect. Desktop watchers are stored per repo, pause while
another repo is open, and stop when their worktree is removed. Push `spawned`
and `ended` events; other status is read through the sidebar. `onStatus` fires
on transitions, not timestamp-only changes. Timing overrides support tests that
assert the actual prompt received by a fake agent.

## Pull request caching and providers

The desktop sidebar, babysitters and sync loop share core's per-repo PR cache.
Key cache entries, in-flight requests and sequence guards by cwd. Only the newest
fetch for a repo commits. Failures retain the last good list and retry on the
interval. Changing global credentials clears entries and invalidates in-flight
results. `cached`/`refreshInBackground` support polling; explicit reads can await
refresh. The TUI's `usePrData` is its process's single list reader.

GitHub uses authenticated `gh`; offline tests replace that executable on PATH.
Azure DevOps uses REST and a PAT, with recorded anonymized fixtures rather than
e2e coverage. Extend those fixtures when changing Azure behavior. Scrub identities
and repository details from recordings; keep credentials out of fixtures.

Azure statuses are history. Group by context and choose the newest iteration,
date and id. `notApplicable` retracts a check without voting; missing state means
queued (`notSet`). Branch-policy build validation uses policy evaluations,
which this status path does not read.

Azure request budgets prevent per-PR polling from exhausting organization limits:

- Memoize settled CI against both source and target merge commits. Pending CI
  is reread first; comments are not keyed to commit identity.
- Separate the displayed answer from a result complete enough to memoize.
- Budget detail reads per cycle and order by last read, with id as a stable tie
  breaker. Age entries out instead of deleting visible answers on refresh.
- A missing row on a complete runs page means no build. On a truncated page or
  failed lookup, omit the row: it has not been resolved and must not be cached as none.

Babysitter thread reads use the provider throttle and TTL outside the list-cycle
budget. GitHub gets rollup and counts with its list query and needs no equivalent
per-row cache-reset methods. `request-budget.spec.ts` checks request counts.

## Diff generation and rendering

PR diffs compare commits so review anchors remain stable. Bare worktree diffs
include index, working tree and untracked files. Build untracked patches without
`git add -N`: displaying a diff must not modify the agent's index. Poll active
worktrees; do not recursively watch a checkout and exhaust inotify on dependencies.

Whole-file context (`-U99999`) supports comments on unchanged lines; fold it in
the viewer. Stream git output with `runGit`, which preserves partial output and
reports truncation rather than discarding the entire buffer on overflow.

Bound worktree diffs before expensive reads. Use `lstat` for symlinks, churn to
bound deleted files, and exclude both paths of an oversized rename. A content-free
rename only needs headers. Size untracked files before reading, respect git ignores,
and render symlinks as mode-120000 patches without following them. Trim total-output
overruns at complete file boundaries. The PR path retains files because review
comments depend on them. Git-backed regression cases live in
`worktree-diff.integration.spec.ts`.

File-tree collapse state follows each file's content revision, not poll timing
or churn counts. Ignore temporary empty snapshots; unchanged snapshots preserve
state. Open ancestors only for new or changed files.

## TUI, browser bridge and packaging

Ink passes `TerminalEmulator` ANSI through `<Text>`; raw stdin forwards to the
PTY. Strip CI-related variables when spawning the interactive TUI. The serve
target sets `TSX_TSCONFIG_PATH` for automatic JSX transformation.

The wterm host keeps the PTY alive across WebSocket reconnects and replays a ring
buffer. Use one build script for server and client to avoid output-directory
cleaning conflicts. Playwright and Nx must agree on artifact output paths.

Pin desktop and wterm-host packages to the same exact wterm version. Separate
copies have incompatible constructor identities for `instanceof`. Import CSS
from `@wterm/dom/css`; the React package's relative CSS import depends on hoisting.
For pasted images, the host chooses the temporary-file suffix from its own MIME
table and inserts the path into the PTY; text paste stays with wterm.

Comment images use _virtual_ kitty placements (`U=1`) written out-of-band
with `process.stdout.write`, the precedent being `apps/cli/src/utils/window-title.ts`;
`CommentProse` then renders U+10EEEE placeholder rows as ordinary Ink `<Text>`,
clipped to the card interior so Ink never draws a truncation `…` over the image.
Each distinct url is fetched and decoded once. Kitty loops animated GIFs natively
(`a=f` frames plus `a=a,s=3,v=1`, no ongoing traffic); ghostty lacks `a=f`, so
Kirby re-transmits frames on a chained timeout (≤120 frames, ≥50 ms per frame,
≤3 concurrent) while a reviews pane shows, and `KIRBY_GIF_ANIMATION=off` keeps a
static composite. Image download and decoding live in `libs/image-loader`, the
protocol in `libs/kitty-graphics`.

Mouse tracking (`?1000h`) is refcounted across consumers because the enable and
disable writes are global to the terminal; batching every SGR report in a stdin
chunk is what makes a fast wheel spin scroll by more than one line.

For release preparation and global-install constraints, see
`.agents/skills/publish-beta/references/packaging.md`.
