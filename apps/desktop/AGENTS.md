# apps/desktop — the Electron shell

`src/main` owns the window and native menu; `src/preload` exposes a typed
`window.kirby`; `src/host/contract.ts` is the single source of truth for the
bridge API and IPC names; `src/host/services` are main-process services;
`src/renderer` is Vite + React 19 + Tailwind v4 with no Node access, its
`lib/` grouped by subsystem (`data`, `diff`, `tabs`, `plan`, `review`,
`sidebar`). Dev: `scripts/dev.mjs`. Headless visual QA: `scripts/qa-shots.mjs`.
Every rule below has its reasoning in `docs/decisions.md`.

## Host

- `services/repo.ts` `openRepo` does what the TUI's `useSessionManager` mount
  does: detect project config, set the worktree resolver, apply the session
  backend. `main.ts` **awaits** `probeTmuxAvailability()` before wiring the
  backend; firing it off strands a tmux machine on PTY for the whole run.
- The host holds one repo (`requireRepo`, memoized root, the
  `@orchestra-repo` every tmux session it creates is tagged with). The tab
  strip spans repos: activating a foreign tab opens its repo
  (`useRepoFollowsTabs`); nothing renders another repo's content in place.
- Sidebar answers are stamped with the repo they describe
  (`getSidebarSnapshot`) and the renderer drops answers for a repo it is not
  showing (`loadSidebarModel`). A switch is in flight for several awaits.
- The pull request list is fetched once per interval in core's cache
  (`services/pull-requests.ts`); `services/sidebar.ts`, babysitters and the
  sync loop all read it there. Do not call the provider from a second place.
- Babysitters (`services/babysit.ts`) live per repo in memory, sit out while
  another repo is open, stop when their worktree is removed, and push only
  `spawned` and `ended`; everything else rides on the sidebar poll.
- `services/settings.ts:updateSettingsFromView` refuses a backend switch with
  live sessions and refuses tmux when the probe says unavailable.
- Terminal tabs have no state file; tmux is the record: the kind is the
  `@orchestra-session-type` tag (`shell` | `agent`), the name is a label
  (`<repo>-shell`, suffixed on collision) and the key, the directory is
  `#{session_path}`. The tab group is derived at read time
  (`services/terminal-home.ts`). Closing a terminal tab confirms and kills;
  quitting only detaches.
- Pasted images are written under the OS temp dir
  (`services/clipboard-image.ts`), suffix from the host's own MIME table, and
  the path is typed into the PTY.
- Worktree removal here calls `killPersistedTmuxSession`; the TUI's does not.
  See the layering rule in the root `AGENTS.md`.

## Renderer

- Native OS elements where they exist: application menu (`main/menu.ts`),
  context menus (`showContextMenu` → `Menu.popup`), native dialogs, optional
  native frame. Web-rendered menus only for what the OS cannot express.
- Tabs have exactly one reconciliation point: `Workspace` hands the item list
  to `sync-items` in `lib/tabs/tabs-model.ts`, a pure reducer that re-keys
  stale tabs, opens a tab per newly running agent (`autoOpened`,
  repo-qualified), pins previews with a live agent, and adds foreign and
  terminal tabs. Add nothing to that seam from an effect. A tab is identified
  by PR id or `(repo, branch)`, `repo` being the real path
  (`canonicalRepoPath`). `TabsProvider` sits above the repo gate in `App.tsx`.
  `tabs.properties.spec.ts` holds the invariants.
- A PR tab is a review workspace (`components/review/PrWorkspace.tsx`): a
  collapsible rail (Agent · Files · Comments) beside one content pane that
  swaps between diff, agent terminal (kept mounted) and `ReviewStepper`. The
  diff toolbar lives in `DiffPane`, not the tab header.
- Diffs are whole-file (`-U99999`), folded client-side
  (`lib/diff/diff-model.ts`). A PR diffs commits; a bare worktree diffs its
  working tree, polled at 2 s only while the agent runs. `FileTree` collapse
  state is reconciled from the per-file `revision` delta during render
  (`lib/diff/file-tree-model.ts`), never from the poll.
- The plan is a cart of value snapshots (`@kirby/core/plan`). The prompt is
  composed in the renderer so the preview is the delivery; `plan-model.spec.ts`
  asserts numbering against `planRows`. Adopting a respawned session carries
  the chunk `seq` forward.
- `SessionTerminal` sends `resizeSession` on every fit and refits on the
  session's `spawnedAt` epoch. `paneTerminalGrid` measures a hidden `.wterm`
  inside `[data-terminal-pane]` for the launch estimate.
- `terminal-ended` closes a terminal tab by name at once; `dropEnded` closes
  any terminal tab a _defined_ listing omits, and `undefined` means not asked
  yet.
- PR row status circle (`lib/sidebar/sidebar-model.ts` `prStatusIndicator`):
  colour is the worst blocker, glyph the more severe axis, filled means nothing
  outstanding. CI escalates but never vouches. The 4×4 grid is asserted whole
  in `sidebar-model.spec.ts`.
- `applyPendingRemovals` drops a session row but keeps a PR row with
  `sessionName`/`running` cleared.
- Comment markdown paragraphs render as `<div>` (block images cannot nest in
  `<p>`); images are host-fetched with provider auth. `ErrorBoundary` wraps
  each tab.
- Components use design tokens from `styles.css` and the primitives in
  `components/ui` only. Check visual work with `scripts/qa-shots.mjs`.

## Dependencies and packaging

- `@wterm/dom`, `@wterm/react` here and `@wterm/dom` in `apps/cli-wterm-host`
  are pinned to one exact version. Upgrade all together and check
  `npm ls @wterm/dom @wterm/react @wterm/core` shows one copy each. Import the
  stylesheet from `@wterm/dom/css`, never `@wterm/react/css`.
- Published as `@hermannbjorgvin/kirby-desktop`; `prepare-install.mjs` writes
  `dist/package.json`. Linux installs compile `node-pty`. See the
  `publish-beta` skill.
