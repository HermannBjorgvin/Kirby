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
receive registry names from core; `session-identity.ts` owns what a tmux
session is called and how it is recognised.
`resolveTerminalBackend` honors project then global configuration, otherwise
uses the tmux probe. Do not persist the detected default: another machine may
have different capabilities. Await the probe before wiring the backend.

A backend switch requires no live sessions; selecting tmux requires a successful
probe. Both shells enforce this so sessions cannot retain an obsolete factory.

Tmux launch resolves first and attaches, else creates detached, tags and then
attaches (see the next section). `dispose()` detaches the client; `kill()` ends
the session. Application shutdown must dispose, including `killAll()`. A tmux
server retains its original environment, so sessions receive explicit HOME,
PATH and seed variables. The `-e` options require tmux 3.2; check
compatibility when changing the older availability-probe floor.

Tests must isolate the socket and environment. `TMUX` names a socket directly
and overrides `TMUX_TMPDIR`: unset it, place the socket directory inside the
fixture HOME, and assert isolation before listing or killing sessions. Never
use `tmux kill-server`. Fixtures select PTY unless a test explicitly exercises
tmux or an unset backend. This prevents detached agents leaking after tests.

`list-sessions -F` output is tab-separated. A tmux client whose locale is not
UTF-8 rewrites control characters in that output to `_`, which folds every
column into the name, so `tmux-cli.ts` passes `-u` to every command whose
output it parses (`list-sessions -F`, `show-options`).

## Session identity shared with Orchestra

Names are labels, tags are identity. Kirby and Orchestra create and inspect
the same tmux sessions, and a session's name is a human-readable label chosen
once at creation and never parsed: `<repo>-<branch>` for a worktree session,
`<repo>-shell` or `<repo>-agent` for a terminal tab, where `<repo>` is the
basename of the symlink-resolved main checkout and every `/`, `.` and `:`
becomes `-`; a name over 200 characters keeps its first 195 and gains `-` plus
four hex digits of the SHA-256 of the unsanitized string the label was built
from — `<basename>-<branch>` for a worktree session, `<basename>-shell` /
`<basename>-agent` for a terminal tab. If any
session on the server already holds the name — foreign, another checkout with
the same directory name, a second shell tab — `-2`, `-3`, … is appended to the
preferred label until one is free, after the cap and without capping or
hashing again (a capped label plus `-2` is 202 characters), and nothing ever
reconstructs that suffix. A create that loses the race for a candidate keeps
probing from the original preferred label, so a second race yields `-3`,
never `-2-2`.
The rule is implemented twice, in bash and in TypeScript, so
`session-identity.spec.ts` and agent-plugins' CLAUDE.md pin one table of
inputs and outputs that must stay identical.

Everything that identifies a session is a tmux session user option — a tag —
on the session itself: `set-option -t '=<name>:' @orchestra-x value` to
write, `#{@orchestra-x}` in a format string to read. Tags die with the
session; no file records them. A value is a plain string without tabs, and an
absent tag is unset, never a sentinel. Whichever program creates a session
writes `@orchestra-spawner` (`kirby` or `orchestra`), `@orchestra-repo` (the
symlink-resolved main checkout), `@orchestra-session-type` (`worktree`,
`shell` or `agent`) and, on a worktree session, `@orchestra-branch`
(unsanitized; a detached-HEAD worktree's directory name). A later attach never
rewrites them. The names live in `libs/core/src/lib/session-identity.ts`;
`libs/terminal-tmux` carries them as opaque `tags` and option-name arguments
and knows neither `@orchestra-` nor `kirby`. The `=name:` exact target form
needs tmux 2.1; the availability probe still accepts 2.0.

A worktree session's identity is (`@orchestra-repo`, `@orchestra-branch`),
string equality on both; a terminal tab's is its name, which is unique on the
server. Every lookup — attach, exists, kill, adopt, list, orphan detection —
goes through one resolver (`session-resolver.ts`): one `tmux -u list-sessions
-F` fork carrying `#{session_name}`, `#{session_created}`, every tag and
`#{session_path}`, matched client-side, never `list-sessions -f` (tmux 3.1).
When several sessions claim one identity the oldest by `session_created` is
the one acted on and the rest are listed, never silently killed. "Ours" is
spawner set and session type set: a session whose name Kirby would have
chosen but that lacks those tags is foreign, and is never attached to, killed,
adopted or listed. That is why there is no git fallback for an untagged
session and why a destructive or attaching command takes a name only after
the resolver verified it — `killPersistedTmuxSession` refuses a session that
merely carries the expected name. `projectKey` remains config storage's and
is used by no tmux code.

The backend (`tmux-backend.ts`) therefore no longer runs `new-session -A`. It
asks the caller's `resolve(spec)` for an existing name and attaches to it
exactly; otherwise it takes `label(spec)`, probes `has-session` for the first
free candidate, creates it with `new-session -d`, moves to the next candidate
if tmux reports a duplicate (another creator won the race), writes `tags(spec)`
as session options, and only then attaches a client. Creating detached and
tagging first means the tags exist before anything can observe the session,
which removed the old post-hoc `set-option` retry loop; and resolving before
creating means a name that happens to be taken is never attached to. `status
off` is set on every attach; tags never are. Kirby's answers to the three
questions are composed in `tmux-factory-options.ts` from the repo root: a
worktree spec is identified by the branch in its directory's HEAD file (no git
fork); a terminal spec is told apart by the session-type tag its launcher
passes through `spawnSession`, and is identified by the name core chose as a
free label before spawning, which is also its registry key. Two lookups, not
one: `resolveRegistrySession(repo, key)` answers a registry _key_ with a
worktree session by (repo, branch) and nothing else. A key is a branch with
`/` rewritten, never a tmux name, and the two namespaces overlap — repository
`feature`'s agent on branch `x` is labelled `feature-x`, which is the key of
the branch `feature/x`, and an agent tab is called `<repo>-agent`, which is
the key of a branch of that name — so answering either by name would have the
worktree removal kill a session that is on no such branch.
`resolveSessionByName(name)` answers a tmux _name_ across
all our tagged sessions, any type, no repository scope, because a name is
unique on the server and a terminal tab — including an adopted orphan still
tagged `worktree` and with the repository it came from — is process-global and
outlives a repository switch. `new-session -d` starts the command before the
tags are written, so a concurrent scanner treats the session as foreign for
the poll in which it is still untagged; the next poll sees it.

Discovery (`observeTmuxSessions`) reads the same listing once: a worktree is
persisted when a session is tagged with the open root and the branch the
worktree list reports (the directory's name for a detached HEAD); a session
tagged with the open root on a branch no listed worktree is on is an orphan —
the agent checked out another branch inside its worktree — and surfaces as an
agent terminal in its `session_path` unless the registry already holds it
under the branch it was spawned with; terminal tabs are found by session type
wherever they run. `listLiveWorktreeSessions`, which spans repositories,
takes the repository from the tag and includes a session only while its
directory's HEAD is still on the tagged branch. Registry keys are unchanged:
worktree sessions by `branchToSessionName(branch)`, terminal tabs by their
tmux name.

## Discovery and terminal lifecycle

Discovery polls tmux and worktrees, diffs observations with `diffScans`, and
attaches through `spawnSession`. Polling avoids server-global tmux hooks and
control clients that can resize panes. Recheck session liveness and the selected
backend after awaits: the user may launch a session or switch backends mid-scan.
Pass retired names as `suppressed` so they do not trigger a refresh every poll.

Discovery recognises a session by its tags alone (see "Session identity shared
with Orchestra"): a worktree is persisted when a session is tagged with the
open root and the worktree's branch, and attaching goes through `spawnSession`
so the backend resolves that session and attaches rather than creating a
second one. There is no name matching, no git fallback and no origin cache: a
session without tags is foreign, and one with them needs no git to describe.
Discovery uses the open repo's backend configuration, including its
per-project override.

Standalone terminal sessions are tagged `@orchestra-session-type` `shell` or
`agent`, named `<repo>-shell` / `<repo>-agent` (suffixed on collision) and
located by tmux's `session_path`; no separate state file is needed.
`newTerminalSessionName` survives with new semantics: it picks a free label —
not held by this process, not a session on the server — before the spawn, and
that label is the tab's registry key. An empty command means the backend's
default shell. Agents use `launchTerminalSession` → `launchSession`. A worktree
session whose branch changed appears as an agent terminal instead of
disappearing; adopting it attaches by exactly the name tmux holds it under,
resolved among our tagged sessions whatever their type, so the orphan keeps
its `worktree` tag and no second agent is started beside it.

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
