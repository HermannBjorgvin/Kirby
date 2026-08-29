<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax

<!-- nx configuration end-->

---

# Workflow Manager Development Guide

## Core Process

1. **One feature at a time.** Implement the smallest possible increment that can be visually verified or tested. Never batch multiple features into a single pass.
2. **Visual first for TUI work.** Get something on screen before building supporting infrastructure. Mock data is fine — proving the rendering/interaction works is the priority.
3. **Check in at every milestone.** After each feature, stop and tell the user:
   - What was implemented
   - How to test it manually (exact commands)
   - Wait for their feedback before continuing
4. **Don't build what you can't verify.** If behavior depends on real-world interaction (e.g. Claude session status patterns), don't guess — build a testable mock first, observe the real thing, then implement.
5. **Commit after every code-generating or install command.** NX generators, `npm install`, `npm uninstall` — commit immediately before making manual changes.
6. **Iterate with the user, not ahead of the user.** The user is part of the development loop. Their manual QA testing is essential. Don't race ahead building layers of code they haven't seen yet.

## Ink.js / TUI Patterns

- **Use the `cli-design:inkjs-design` skill** for component patterns, layout, input handling, testing, and gotchas. Check it before guessing at Ink APIs.
  - `cli-design:inkjs-cli layout` — responsive layout, `useStdout` for terminal dimensions
  - `cli-design:inkjs-cli testing` — `ink-testing-library` patterns
  - `cli-design:inkjs-cli input` — keyboard input, `useInput` patterns
  - `cli-design:inkjs-cli gotchas` — emoji width, Ctrl+C, useInput conflicts
- **Full-screen layout:** Use `useStdout()` to get `rows`/`columns`, set `height={rows}` on root `<Box>`.
- **PTY sizing:** The PTY session is sized to match the terminal dimensions minus UI chrome (sidebar width, borders, status bar).
- **ESM required:** Ink v6 + yoga-layout use top-level await. All packages must have `"type": "module"` in package.json.

## Testing Strategy

- **TDD for libraries:** `worktree-manager` (worktree.ts) — mock `exec`, test parsing and CRUD logic.
- **Ink components:** Use `ink-testing-library` to verify text content + keyboard navigation. No real TTY needed.
- **Manual testing for:** ANSI/visual rendering, PTY input forwarding, anything involving real terminal interaction.
- **Run tests via NX:** `npx nx test worktree-manager`
- **Dev run:** `npx nx serve cli` (rebuilds stale lib deps, then runs via tsx)

### Desktop Tests (`apps/desktop`, `apps/desktop-e2e`)

```sh
npx nx test desktop              # unit (vitest)
npx nx e2e desktop-e2e           # e2e: launches the built Electron app
npx nx e2e:visual desktop-e2e    # screenshots, inside a pinned container
```

**E2E drives the real app.** `apps/desktop-e2e` uses Playwright's Electron
driver to launch the _built_ desktop app against a throwaway git repo with an
isolated `HOME`, so tests exercise the actual main process, preload bridge and
renderer. The nx targets depend on `desktop:build` — but `node run-e2e.mjs`
and `node run-visual.mjs` do not, so when invoking either directly **rebuild
first** (`npx nx build desktop`) or you are testing the previous build. This
bites hardest on the screenshots: a stale bundle matches the old baselines
locally and fails on CI, which builds.

The fixture (`src/fixtures/desktop.ts`) gives each test a repo (optionally
seeded with branches and worktrees, including mid-rebase / detached-HEAD /
deleted-directory states), a `~/.kirby` of its own, a scriptable fake agent for
`aiCommand`, and **fails any test whose renderer throws** — an ErrorBoundary
otherwise turns a crash into a blank pane that assertions pass straight over.

**README media is generated, not hand-recorded** (`apps/desktop-e2e/demo/`,
its own README). `node apps/desktop-e2e/demo/capture.mjs` drives the
_built_ app under a dedicated Xvfb display at 2x scale, records with
`ffmpeg -f x11grab` and writes the GIFs and stills in `docs/media/`. It
reuses the fake `gh` below for pull requests, plus a demo agent whose
output is paced to look like work rather than to be asserted against,
so a capture needs no token, no network and no real agent. Recordings
land in the gitignored `docs/media/raw/`; a failed take leaves the
frame it died on there.

**A fake `gh` makes pull requests exist offline.** The GitHub provider
reaches GitHub only by running the `gh` CLI, so `setup/fake-gh.ts` puts
an executable named `gh` at the front of the app's PATH and answers from
a JSON scenario (`fakeGitHub` fixture option: PRs, review threads,
general comments, check rollup). Point a PR's `headRefName` at a branch
the test repo really has and the diff is a real one computed by git.
Before this, everything behind a pull request — the review workspace,
threads, drafts, the plan — was reachable only from the `@integration`
suite, which needs a token and so does not run on most pull requests. It
changes no production code: the seam is PATH. Note `git-repo.ts` seeds a
worktree at `.claude/worktrees/<branch>` verbatim while the app resolves
its own sanitized directory name, so seeded branches must be slash-free.

**It runs headless, always.** `run-e2e.mjs` wraps the run in xvfb on Linux even
when `DISPLAY` is set, because otherwise the app steals focus and anything you
do meanwhile changes what the tests see. `KIRBY_E2E_HEADED=1` to watch it. On
Wayland that is not enough on its own: Electron talks to the compositor through
`WAYLAND_DISPLAY` and ignores the X display xvfb hands it, so the fixture drops
that variable and pins `--ozone-platform=x11`.

**Screenshots run in a container** (`run-visual.mjs`, tagged `@visual`, excluded
from the default `e2e` target). Fonts differ between machines, and a pixel-ratio
tolerance is far stricter on a small dialog than on a full window — CI failed
both dialogs at 4% while passing everything else. Everything renders in the
Playwright image pinned to our Playwright version, in CI and locally alike, so
the tolerance is **zero**: any differing pixel fails. Regenerate baselines with
`node run-visual.mjs --update-snapshots`, and review the diff before accepting.

**Integration tests** (`nx e2e:integration desktop-e2e`, tagged
`@integration`) read the permanent fixture pull requests in the shared sandbox
repo through the real provider — the only coverage of the review workspace,
since everything else runs offline. They are read-only, and skipped without
`GH_TOKEN`. The app needs that token handed to it explicitly: each test gets an
isolated `HOME`, so the `gh` CLI it authenticates through cannot see stored
credentials. Locally: `GH_TOKEN=$(gh auth token) npx nx e2e:integration
desktop-e2e`.

When configuring a provider from a test, project fields go under
`vendorProject` — with that key absent the host auto-detects from the git remote
and overwrites what you set, which presents as the provider silently returning
nothing.

**Native menus** are reachable from tests: `setup/menu.ts` arms a one-shot
interception of `Menu.popup` (context menus) and clicks application-menu items
directly. Several commands have no other route — Ctrl+, is a menu accelerator,
not a renderer keybinding.

**Property tests** (`fast-check`) cover the tab reducer and the diff model,
where the bugs have been invariant violations rather than missing examples:
every comment emitted exactly once, one tab per item, `activeId` always
resolving. They use random seeds, so a failure may appear on CI and not
locally — the reported counterexample is the bug, not noise. Pin any it finds
as a worked case.

**When adding a test, break the code on purpose and confirm it fails.** Several
tests here looked thorough and caught nothing until a deliberate mutation showed
which case actually discriminates.

### E2E Tests (Playwright + wterm)

E2E tests run Kirby in headless Chromium via the `apps/cli-wterm-host/` bridge
and drive it with `@playwright/test`.

```sh
npx nx e2e cli-e2e               # offline tests only
npx nx e2e:integration cli-e2e   # offline + @integration-tagged (needs GH_TOKEN)
```

Tests live in `apps/cli-e2e/src/*.test.ts` and use the fixture at
`apps/cli-e2e/src/fixtures/kirby.ts`. Per test, the fixture:

1. Creates a temp git repo (`createTestRepo()`) + isolated HOME with optional `.kirby/config.json`.
2. POSTs `/spawn { repoPath, homeDir, env, cols, rows }` to the wterm host.
3. `page.goto('/')` and waits (30s) for `getByText('Kirby')` — signals the PTY has painted.
4. Yields `{ term, repoPath, homeDir }` to the test.
5. Teardown: POSTs `/kill`, removes tempdirs.

```ts
import { test, expect } from './fixtures/kirby.js';

test.use({ kirbyConfig: { keybindPreset: 'vim' } });

test.describe('Example', () => {
  test('arrow down works', async ({ kirby }) => {
    await kirby.term.press('ArrowDown');
    await expect(kirby.term.getByText('Settings')).toBeVisible();
  });
});
```

The `term` object exposes `getByText`, `press(key)`, `type(text, {delay})`, `write(rawBytes)`, and `resize(cols, rows)`. Integration tests tag their `test.describe(...)` with `@integration` so `nx e2e` skips them via `--grep-invert @integration`.

**wterm host (`apps/cli-wterm-host/`)** — Node HTTP + WS server:

- `POST /spawn` — kill any existing PTY, clear buffer, spawn fresh Kirby (see env-strip pitfall below).
- `POST /kill` — kill current PTY.
- `WS /pty` — replays the output ring buffer (~2 MB) on connect, streams live. **Does NOT kill the PTY on close** (by design — survives the browser's 1001 "Going Away" during cold start). Auto-spawns a dev-default tempdir if a client connects with no prior `/spawn`, so `npx nx serve cli-wterm-host` + open Chrome "just works".
- Single active PTY at a time (workers=1 in Playwright, no multiplexing).

**How to debug a failing Playwright test:** `playwright.config.ts` has `trace: 'retain-on-failure'` + `screenshot: 'only-on-failure'` + `video: 'retain-on-failure'`. CI uploads `apps/cli-e2e/test-output/` as `playwright-test-output` artifact on failure. Locally, run `npx playwright show-trace apps/cli-e2e/test-output/playwright/output/<test>/trace.zip`.

### Interactive QA (Playwright MCP + shared Chrome)

Both the VSCode debugger and the Playwright MCP connect to the same Chrome instance via CDP on port 9222, using the isolated profile at `.vscode/chrome` (gitignored). Only **one** Chrome should be running at a time — the user launches it one way or the other, and Claude (via MCP) attaches.

**Launch paths (pick one):**

- **VSCode F5** → `Kirby in Chrome (wterm)` config. Starts the wterm host via the `serve cli-wterm-host` preLaunchTask, then Chrome with `--remote-debugging-port=9222 --user-data-dir=${workspaceFolder}/.vscode/chrome`. Also attaches VSCode's JS debugger.
- **VSCode Run Task → `Launch Chrome for Kirby QA`** — same Chrome args, no JS debugger attached. Useful if you just want to browse Kirby without a debugger session.
- **Bash (Claude or user)**:
  ```sh
  chromium \
    --remote-debugging-port=9222 \
    --user-data-dir=.vscode/chrome \
    --no-first-run \
    --no-default-browser-check \
    --hide-crash-restore-bubble \
    http://localhost:5174 &
  ```
  (Requires `npx nx serve cli-wterm-host` to already be running.)

**Playwright MCP (`.mcp.json`)** is configured with `--cdp-endpoint http://127.0.0.1:9222`, so it _only attaches_ — it never spawns its own browser. The user must start Chrome one of the above ways before MCP tools will work. If MCP shows connection errors, Chrome probably isn't running (or is on a different port).

**Port/profile collisions:** only one Chrome process at a time can own `.vscode/chrome`. If VSCode's F5 complains about the port or profile being in use, close the other Chrome first.

### Integration Tests

Integration tests exercise real GitHub operations and are **skipped** when `GH_TOKEN` is not set.

- `merge-auto-delete.test.ts` — creates branches, PRs, merges, verifies Kirby auto-deletes the session
- `reviews-fixture.test.ts` — reads 3 permanent fixture PRs in the test repo, verifies the Reviews tab categorizes them correctly

**Running locally:**

```sh
GH_TOKEN=<fine-grained-PAT> npx nx e2e:integration cli-e2e
```

**Required PAT permissions** (scoped to the test repo only):

- Contents: Read & Write (clone, push branches, delete branches)
- Pull requests: Read & Write (create, merge, close PRs)
- The PAT owner must have admin access on the test repo (for `--admin` merge)

**Environment variables:**

- `GH_TOKEN` — fine-grained PAT for the test repo (required to run integration tests)
- `TEST_REPO` — override the test repo (default: `kirby-test-runner/kirby-integration-test-repository`)
- `KIRBY_LOG` — set automatically by the test to capture debug logs from the Kirby process

**Fixture PRs in the test repo** (used by `reviews-fixture.test.ts`):

| PR   | Branch                      | Title                                  | CI     | Review (by kirby-test-runner)                                                          |
| ---- | --------------------------- | -------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| #37  | `fixture/add-color-support` | Add color support for tile values      | passes | Approved                                                                               |
| #38  | `fixture/add-undo-feature`  | Add undo feature with history stack    | passes | Changes requested (3 inline comments)                                                  |
| #39  | `fixture/add-ai-solver`     | Add AI solver for auto-play mode       | fails  | Approved (1 suggestion comment)                                                        |
| #322 | `fixture/outdated-thread`   | Outdated thread fixture (do not merge) | n/a    | 2 outdated inline comments (by HermannBjorgvin) + kirby-test-runner involvement marker |

These PRs are permanent fixtures — tests only read them, never modify. The test repo contains a C 2048 game project.

PR #322 is an exception in shape: it has two commits where the second
rewrites the function the review comment was anchored to, so GitHub
flags the thread `isOutdated: true` with `line: null` and only
`originalLine` set. Used by `outdated-thread.test.ts` to verify the
diff viewer renders outdated threads inline at their `originalLine`
instead of dropping them into the "comments on lines not in diff" tail.

PR #322 was authored by HermannBjorgvin and the outdated review
comments are by HermannBjorgvin too. Kirby's PR sidebar uses GitHub
search with `involves:${username}`, which would normally exclude this
PR for `kirby-test-runner`. To keep #322 visible to the test runner
without changing the production query, a one-time
`kirby-test-runner`-authored review-comment marker was posted on the
PR. If the marker is ever lost, restore it with:

```bash
GH_TOKEN=<integration-pat> gh api \
  repos/kirby-test-runner/kirby-integration-test-repository/pulls/322/reviews \
  -f event=COMMENT \
  -f body="kirby-test-runner involvement marker — keeps PR #322 visible to the involves: sidebar query for the outdated-thread fixture test."
```

**CI pipelines:**

- **CI** (`.github/workflows/ci.yml`) — runs `nx affected -t lint test build typecheck e2e`. Runs `npx playwright install --with-deps chromium` before `nx affected` (needed for `cli-e2e`). Uploads `apps/cli-e2e/test-output/` as an artifact on failure. Integration tests skipped (no `GH_TOKEN`).
- **Integration Tests** (`.github/workflows/integration.yml`) — runs `npx nx e2e:integration cli-e2e` with `GH_TOKEN` from the `INTEGRATION_TEST_PAT` secret. Triggers on PRs, pushes to master, and manual dispatch. Uses `concurrency` with `cancel-in-progress: false` because the test repo is shared state.

## Linting

`eslint.config.mjs` is the single flat config; the three e2e projects
extend it. Beyond `typescript-eslint` strict + `react-hooks` v7
(recommended, at **error** — that is the React team's compiler-powered
analysis, and it passes clean), it enforces four groups.

**Size and shape budgets — warnings, and a ratchet.** `max-lines` 300
(blank lines and comments excluded), `complexity` 20, `max-depth` 4 at
error. These are set where they bound what gets _added_ rather than
where they would be comfortable: a file grows past 300 lines and a
function past 20 branches one plausible edit at a time, and nobody
reviews that as growth. Tighten `complexity` toward 15 then 12 as the
list clears — at 10 it reports 90 functions, which is a list nobody
acts on. Two files carry a 900-line ceiling instead
(`libs/vcs/*/provider.ts`, `keybindings/registry.ts`): they are a REST
surface and an action catalog, and splitting either spreads one lookup
table across files. Specs are exempt from `max-lines` only.

**Type-aware rules** (`projectService`, ~19s workspace-wide).
`no-floating-promises` is why the block exists: Kirby is almost
entirely async git, PTY and provider calls, and a dropped promise there
is a silent no-op plus an unhandled rejection. `ignoreVoid` keeps
deliberate fire-and-forget expressible — `void doThing()` puts the
intent on the page. Also `no-misused-promises`, `await-thenable`, and
`switch-exhaustiveness-check` (a `default` counts), which catches the
"added a union member, missed one of its switches" half-landing.

**Ink rules** (`tools/eslint-plugin-ink.mjs`, TUI only). Ink enforces
its layout contract at _runtime_ by throwing, so a bad component
type-checks, builds, ships, and dies the first time that branch
renders. `no-raw-text` and `no-layout-inside-text` are clean today and
exist to stay that way; `no-bare-process-exit` is off for `main.tsx`
and `commands/**`, which legitimately own exiting. The rules resolve
components through their import, so a renamed `Text` still counts and a
non-Ink `Box` does not.

These are local because the obvious dependency does not work:
`eslint-plugin-react-doctor` ships 22 `ink-*` rules that, enabled at
error, report nothing against a file violating three of them outright
— under both its ESLint bridge and native oxlint. The rest of that
plugin is also a poor fit here: 61% of what `recommended` reports on
this codebase comes from two rules premised on React Compiler, which
we do not run.

**Test hygiene.** `@vitest/eslint-plugin` on `*.spec.*`;
`eslint-plugin-playwright` covers the e2e suites from their own
configs. `vitest/no-focused-tests` is the one that matters — a stray
`.only` leaves CI green while running one test, which is worse than a
red build because nothing signals it.

Everything except `max-depth` and the Ink and vitest rules is a
**warning**. The app predates the budgets; the point is a downward
ratchet, not a wall. Current standing: **0 errors, 100 warnings.**

**`apps/cli` specs are type-checked** via `apps/cli/tsconfig.spec.json`
— it did not exist, so 26 spec files and `src/test-utils/**` were
excluded from every `tsc` invocation. Adding it surfaced two dozen real
errors, including `vi.fn<[], boolean>()` (vitest v1 syntax) typing
mocks as `never`. When adding a project, check its `tsconfig.json`
references the spec project as well as the app one.

## Project Structure

```
apps/cli/                        — Ink TUI application (ESM, React 19) — thin render layer over @kirby/app-core
  src/main.tsx                   — Entry point, root component
  src/input-handlers.ts          — Settings/controls input handlers (keybind-driven state transitions)
  src/components/                — Shared components (SidebarLayout, TerminalView, TabBar, StatusBar, etc.)
  src/screens/main/              — Main tab (sidebar, diff, branch picker, confirm dialogs)
  src/screens/reviews/           — Reviews tab (DiffFileList, DiffViewer, ReviewDetailPane)
  src/hooks/                     — Ink-coupled hooks (useTerminal, useScrollWheel, useRawStdinForward, useDiffListScrollSync)
apps/desktop/                    — Electron GUI shell over @kirby/app-core (kirby-desktop)
  src/main/                      — Electron main: window chrome + security posture (window.ts), native app menu (menu.ts), KIRBY_QA_STEPS hook
  src/preload/preload.ts         — Typed contextBridge → window.kirby
  src/host/contract.ts           — Single source of truth for the bridge API + IPC channel names (incl. MenuCommand, ContextMenuItem, DesktopPrefs)
  src/host/services/             — Main-process services (sidebar w/ remote PR cache, sessions w/ scrollback buffer, settings, desktop-prefs…)
  src/renderer/                  — Vite + React 19 + Tailwind v4 web app (no Node access)
    styles.css                   — Design tokens (VS Code-style light/dark palette, type scale) — components use tokens only
    components/ui/               — shadcn-style primitives (radix-ui + cva + lucide): button, dialog, command, select…
    components/                  — TitleBar, StatusBar, CommandPalette, sidebar/, editor/ (tabs), review/, settings/, terminal/
    lib/queries.ts               — TanStack Query data layer over window.kirby (all host calls + invalidation)
    lib/tabs-model.ts            — Pure editor tab reducer: preview/pinned tabs, `sync-items` reconciliation (tested)
    lib/tabs.tsx                 — TabsProvider/useTabs over that reducer
    lib/diff-model.ts            — Pure diff viewer model: fold unchanged regions, split-view pairing, word diff (tested)
    lib/plan-model.ts            — Pure plan ("add to cart") model: rows, numbering, checkout affordances (tested)
    lib/plan.ts                  — usePlan/usePlanControls over @kirby/core's shared plan store
    lib/use-plan-checkout.ts     — Compose the prompt and send it to the PR's agent
    screens/                     — RepoOpen (repo picker) and Workspace (shell + shortcuts)
  scripts/dev.mjs                — Dev orchestrator: esbuild watch + vite HMR + electron restart
  scripts/qa-shots.mjs           — Headless visual QA: drives the built app under xvfb and writes PNGs
apps/cli-wterm-host/             — HTTP + WS host that bridges Kirby PTY to browser
  src/main.ts                    — Server: /spawn, /kill, WS /pty, ring buffer
  src/protocol.ts                — Shared SpawnRequest + ControlMessage types
  src/public/index.html
  src/public/client.ts           — Browser: @wterm/dom + auto-reconnect WS
  build.mjs                      — Single esbuild script (Node server + browser client)
apps/cli-e2e/                    — E2E tests (@playwright/test)
  src/fixtures/kirby.ts          — Per-test: temp repo, POST /spawn, page, term helpers
  src/setup/                     — git-repo.ts, sidebar.ts, constants.ts, github.ts
  src/*.test.ts                  — Test files (one per feature area)
  playwright.config.ts           — chromium-only, workers: 1, webServer: nx serve cli-wterm-host
libs/core/                       — Shell-agnostic core. No React, Ink or Electron (lint-enforced)
  src/lib/session/               — Session launch + plan checkout flows
  src/lib/plan/                  — Plan store (external store) + prompt composition
  src/plan.ts                    — Browser-safe entry (`@kirby/core/plan`) for the renderer
  src/lib/utils/                 — Pure helpers (sidebar-items, session-sort, diff-fetcher, virtual-viewport…)
  src/lib/settings/              — Settings field model (fields, presets, resolveValue)
  src/lib/sync/                  — Remote sync passes (sweepMergedBranches, conflict counts)
  src/lib/agents/                — Agent registry
  src/lib/activity.ts            — Agent activity registry; pty-registry.ts — PTY session lifecycle
  src/lib/session-backend.ts     — Terminal backend factory wiring (PTY/tmux)
  src/lib/keybindings/           — Customizable keybinding system
    registry.ts                  — Action catalog, presets (Normie/Vim), ActionId type
    resolver.ts                  — matchesKey, resolveAction, findConflict, descriptorFromKeypress
    hints.ts                     — Human-readable key display strings
    controls-data.ts             — Controls panel data logic (buildControlsRows, getBindingRows)
  src/lib/input/                 — KeyPress type (shell-agnostic ink-Key shape) + text-input handling
libs/app-core/                   — The React layer over @kirby/core, shared by both shells
  src/lib/context/               — React state contexts (Config, Session, Sidebar, Nav, Modal, Toast, Layout…)
  src/lib/hooks/                 — Shell-agnostic hooks (useSessionManager, useDiffData, useRemoteComments…)
  src/lib/controllers/           — Headless screen controllers (diff file list / viewer view-models)
  src/lib/plan/use-plan-store.ts — useSyncExternalStore binding for core's plan store
libs/worktree-manager/           — Git worktree and branch operations
  src/lib/worktree.ts            — Worktree CRUD, branch utils, conflict checks
libs/terminal/                   — Terminal emulator (renderer) + SessionBackend interface
  src/lib/terminal-emulator.ts   — @xterm/headless wrapper with ANSI rendering
  src/lib/session-backend.ts     — SessionSpec, SessionBackend, SessionBackendFactory contract
libs/terminal-pty/               — Direct PTY backend (node-pty)
  src/lib/pty-session.ts         — node-pty wrapper (PtySession)
  src/lib/pty-backend.ts         — createPtyBackendFactory()
libs/terminal-tmux/              — Tmux backend (optional system tmux ≥ 2.0)
  src/lib/tmux-cli.ts            — execFileSync wrappers for tmux subcommands
  src/lib/tmux-backend.ts        — createTmuxBackendFactory({ sessionPrefix })
  src/lib/sanitize-tmux-session-name.ts — pure name sanitizer ('.',':' → '-', length cap)
  src/lib/is-tmux-available.ts   — version probe + platform-aware install hint
```

## Known Decisions & Learnings

- **ANSI passthrough works:** TerminalEmulator (@xterm/headless) renders ANSI output which Ink `<Text>` passes directly to the terminal. Colors, bold, underline all render correctly.
- **Input forwarding works:** Raw stdin → PTY write round-trip is responsive enough for interactive use. Mouse tracking and scrollback navigation are supported.
- **NX workspace uses `apps/*` + `libs/*`** (not default `packages/*`). Workspaces configured in root package.json.
- **`npx nx sync`** may be needed when adding cross-library dependencies (e.g. worktree-manager importing terminal).
- **`TSX_TSCONFIG_PATH`:** The serve target sets this env var so tsx picks up `jsx: "react-jsx"` from `tsconfig.app.json`. Without it, tsx defaults to classic JSX transform and requires `import React`.
- **Ink disables its interactive TTY renderer when CI env vars are set.** `CI=true` / `CONTINUOUS_INTEGRATION` / `GITHUB_ACTIONS` all trigger it. If you spawn Kirby from a process that inherits those (e.g. Playwright's `webServer` on GitHub Actions or locally via `CI=1 npx …`), Kirby paints **nothing** — every `getByText` times out. Always strip those three vars in the env passed to the spawned PTY (see `cli-wterm-host/src/main.ts:spawnKirby`). Cost us three CI rounds chasing a phantom WS lifecycle bug before the actual cause was found.
- **Browsers under automation can close a WS with code 1001 ("Going Away") within ~100ms of opening it.** Don't couple PTY lifetime to WS lifetime in the host — the wterm host keeps the PTY alive across WS disconnects and buffers recent output (ring buffer, ~2MB) so a reconnecting client replays the terminal state. Client has a 200ms auto-reconnect on close.
- **NX inline config vs `project.json`:** our apps (`cli`, `cli-wterm-host`, `cli-e2e`) all use inline `"nx": { "name": "...", "targets": {...} }` in `package.json`. Generators default to this in recent Nx, and it keeps the project definition next to its deps. `cli-e2e` defines its `e2e` and `e2e:integration` targets explicitly rather than relying on `@nx/playwright/plugin` inference — we removed that plugin from `nx.json` because (a) we're the only Playwright project and (b) explicit config is easier to reason about (e.g. `e2e` running `playwright test --grep-invert @integration`).
- **Avoid nested platform-split build targets.** Original `cli-wterm-host` had `build-server` (node, `@nx/esbuild`) + `build-client` (browser, custom script) + `build` (noop) with `dependsOn` ordering to work around `@nx/esbuild`'s output-path cleaning. One `build.mjs` running both esbuild invocations is simpler and avoids the ordering bug.
- **Playwright `outputDir` + Nx `outputs` must agree** or nx caching works with stale artifacts. We pin `outputDir: './test-output/playwright/output'` and set matching `outputs` in the `e2e` target.
- **Pluggable terminal backend.** `libs/terminal` only owns the `SessionBackend` interface and the xterm renderer; `libs/terminal-pty` and `libs/terminal-tmux` are interchangeable backends both implementing that interface. `libs/core/src/lib/session-backend.ts` is the _only_ place the literal `'kirby-'` prefix appears — it composes `kirby-${projectKey(repoRoot)}-${branch}` for the tmux session name. The libs themselves know nothing about Kirby, branches, or projects. To add a future backend (SSH, Docker exec…), implement `SessionBackend` in a new lib and add a branch to `buildSessionBackendFactory`.
- **Tmux backend persistence.** Tmux is optional. When selected, the backend spawns `tmux new-session -A -s NAME -- CMD` via the local PTY — `-A` makes the call atomic + idempotent so first launch and resume-after-restart share one code path. **A tmux server keeps the env it was started with** and spawns every session command with it, so the backend pins `-e HOME/-e PATH` + the caller's seed additions per session (tmux ≥ 3.2) — without this, a stale server on the default socket (e.g. left by a test run with a temp HOME) silently kills every agent at launch, and seeded prompts never reach the command at all. E2e runs set `TMUX_TMPDIR` to their temp HOME so test servers can't squat on the user's default socket. `dispose()` detaches the local PTY only; the tmux session keeps running so the next Kirby launch reattaches. `kill()` (called when the user explicitly removes a worktree) runs `tmux kill-session` first. This means **`killAll()` on Kirby exit must call `dispose()`**, not `kill()` — otherwise the persistence benefit is lost.
- **Desktop uses native OS elements where they exist.** Application menu (`apps/desktop/src/main/menu.ts` → `Menu.setApplicationMenu`, commands reach the renderer via `onMenuCommand`), context menus (`window.kirby.showContextMenu` → `Menu.popup`), native dialogs/about box, optional native window frame (`desktop-prefs.json` → `nativeFrame`). Web-rendered menus are only for things the OS can't express (rich dialogs, command palette). VS Code is inspiration for the shell, not a template.
- **Desktop review flow mirrors the TUI.** Launching an agent on any PR item opens the same menu (session / review / review with instructions); `launchReviewAgent` creates the worktree if needed and seeds the agent with `buildReviewLaunchRequest` from app-core (shared with the TUI's confirm menu, so prompt + `kirby util add-comment` guidance are identical). Agent drafts live in `~/.kirby/reviews/pr-<id>/comments.json`; the desktop polls them (`useDraftComments`), renders `DraftCard`s at their anchor in the diff, and posts through `@kirby/review-comments` `postReviewComments` (same poster as the TUI). A PR tab is a review workspace (`components/review/PrWorkspace.tsx`): a persistent, collapsible left rail (Agent · Files · Comments) beside one content pane that swaps between the diff and the agent terminal. The rail owns Launch/Stop; selecting a file or comment shows the diff (`DiffPane` — meta strip + the Unified/Split/Wrap/Hide-resolved/post-drafts/comment-nav toolbar lives here, not in the tab header, so it's gone in terminal view); selecting Agent shows the terminal (kept mounted so scrollback survives). Launching an agent auto-selects the terminal once. When the agent has written draft comments, the rail shows a **Review ready** entry (severity breakdown) that opens `ReviewStepper` in the content pane — a guided walkthrough of the drafts in severity order, each with a code snippet (`SnippetView`) and Edit/Discard/Skip/Post (keyboard e/d/↵, arrows to move); posting advances to the next. `lib/diff-model.ts` has `orderDraftsForReview`/`severityCounts`/`snippetAround` (tested). Terminal fit: `SessionTerminal` measures its pane and calls `WTerm.resize` on ready/visible/resize (autoResize alone latched a stale size until a window resize). Editor tabs are keyed by PR id (renderer `itemKey`), stable as a PR moves between sidebar kinds (launching an agent turns an orphan/review PR into a session row) so the open tab never orphans. The sidebar list and the tab strip are two stores that can disagree, and every tab bug so far has come from reconciling them in pieces — so there is exactly one reconciliation point: `Workspace` feeds the item list to `sync-items`, and `lib/tabs-model.ts` re-keys stale tabs, opens a tab per newly running agent (history in `autoOpened`, so a closed tab stays closed) and pins previews with a live agent, in one pure step. Add nothing to that seam from an effect. `apps/desktop/src/host/services/sidebar.ts` attaches the alive session name to PR items; comment markdown renders images host-fetched with provider auth and its paragraphs render as `<div>` (block images/skeletons can't nest in `<p>`); `ErrorBoundary` wraps each tab so one bad view can't blank the window.
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
- **Desktop diffs are whole-file.** `fetchDiffText` uses `-U99999` so threads on untouched lines can be placed; the desktop viewer folds unchanged regions client-side (`lib/diff-model.ts`, ±3 context, expandable gaps, thread anchors pinned) rather than asking git for hunks.
- **A PR is diffed against commits; a bare worktree against its working tree.** `fetchDiffText` compares two commits, which is what review threads anchor to — a PR tab must never start showing uncommitted scratch work. A worktree with no PR has nothing to anchor, so `PrWorkspace` switches to `fetchWorktreeDiffText` (`libs/core/src/lib/utils/worktree-diff.ts`): merge-base diff run **inside the worktree**, so the index and working tree count, plus hand-built patches for untracked files. Untracked files are assembled rather than obtained via `git add -N`, because writing to the index of a worktree an agent is using changes what its own `git status` and `git commit` see. It polls at 2s **only while the agent is running** — a recursive `fs.watch` over a checkout wants an inotify handle per directory and `node_modules` alone exhausts the Linux default.
- **The PR row's status circle carries two axes, not one.** `prStatusIndicator` (`renderer/lib/sidebar-model.ts`) decides three channels: **colour** is the worst thing standing in the way (red = CI failed or rejected, yellow = CI running or waiting for author, green = all approved, muted = anything else), **glyph** is whichever axis is more severe so the circle depicts what is actually holding the request up, and **filled** means nothing is outstanding at all. Colour is deliberately asymmetric — CI can escalate a row but never vouch for it, so a passing build on an unapproved request stays muted and green means people signed off. Approvals win a glyph tie, which is what stops a green tick appearing inside a red circle on a rejected request. The 4×4 grid is asserted whole in `sidebar-model.spec.ts`: every bug here has been a cell nobody thought to check.
- **Azure PR statuses are a history, not a current state.** `GET /pullrequests/{id}/statuses` returns every status a check has ever posted, across every iteration — re-running appends rather than replaces. `deriveBuildStatus` therefore groups by `context` and counts only the newest entry per check (highest `iterationId`, then date, then `id`); reducing over the raw list made the first failure permanent, so a fixed pull request showed red until it merged and no refresh could clear it. `notApplicable` competes on recency and retracts its own check's earlier verdict, but casts no vote; a missing `state` means `notSet` (Azure omits the field for enum zero) and reads as queued. A recorded, anonymised response lives in `libs/vcs/azure-devops/src/lib/__fixtures__/` — record new ones by hitting the API with the PAT from `~/.kirby/config.json`, scrubbing org/repo names and the `createdBy` identity, and reading them with `readFileSync` in the spec so they stay data rather than joining the module graph. Note the badge only ever reflects `/statuses`: a repo whose CI runs through **branch-policy build validation** reports under `_apis/policy/evaluations` instead, which Kirby does not read.
- **The three `@wterm/*` packages move as one, and are pinned exactly.** `@wterm/react` declares `@wterm/dom` as an **exact** peer (`"0.3.4"`, not a range) and `@wterm/dom` pins `@wterm/core` the same way, so a caret on any of them lets npm take a newer one than its sibling peer-requires and the tree stops resolving. To upgrade, set the same exact version in **both** `apps/desktop/package.json` (`@wterm/dom`, `@wterm/react`) and `apps/cli-wterm-host/package.json` (`@wterm/dom`), then `npm install` and check `npm ls @wterm/dom @wterm/react @wterm/core` shows one deduped copy of each. Verify with `nx e2e cli-e2e` (the harness terminal), `nx e2e desktop-e2e` and `nx e2e:visual desktop-e2e` — the last is what catches a stylesheet change, at zero pixel tolerance. Releases have been roughly weekly, so this is worth doing periodically rather than once.
- **Take the terminal stylesheet from `@wterm/dom/css`, never `@wterm/react/css`.** The react one is a single `@import "../../dom/src/terminal.css"` — a relative path that resolves only while npm keeps the two packages physically adjacent. The moment anything else in the workspace wants the same `@wterm/dom` version, npm hoists it to the root and the renderer build fails to resolve the import. `@wterm/dom` publishes the identical file under its own `./css` entry, which package resolution finds wherever the package lands.
- **Pasted images reach the agent as a path.** wterm's paste handler reads `clipboardData.getData('text')` and returns when there is none, so an image on the clipboard silently went nowhere. `SessionTerminal` takes image pastes in the capture phase, the host writes them under the OS temp dir (`services/clipboard-image.ts`) and the path is typed into the PTY. The suffix comes from the host's own MIME table, never the renderer-supplied string. Text pastes still fall through to wterm, which brackets and sanitises them.
- **Optimistic worktree removal treats the two row kinds differently.** `applyPendingRemovals` (`renderer/lib/sidebar-model.ts`) drops a `session` row outright — the row _is_ the worktree — but keeps a PR row and clears only its `sessionName`/`running`, because the pull request outlives its checkout and the refetch would put the row straight back. Hiding both was why removing a worktree from a PR row felt unresponsive.
- **Switching backends is gated to no-active-sessions.** `apps/cli/src/input-handlers.ts:canApplyFieldChange` blocks the `terminalBackend` toggle whenever `hasAnySession()` is true and refuses a switch to tmux when `getTmuxAvailability()` reports unavailable (with the install hint). Without this guard, sessions would be stranded on a stale backend factory. The desktop enforces the same guards host-side in `apps/desktop/src/host/services/settings.ts:updateSettingsFromView`.
- **Two shells over one core.** `@kirby/core` is the shell-agnostic half of the app — git, worktrees, PTY and session infrastructure, config, providers, keybindings, the plan store, pure helpers. The TUI and the desktop render over it; they decide what the user sees and how it is driven, and they own no sequences of git / filesystem / PTY / config / provider calls. `@kirby/app-core` is the React layer above core (contexts, hooks, headless controllers) and is imported only by shells that render with React. Three lint rules hold the shape, and each was verified by writing the violation and watching it fail: `scope:core` may not depend on `scope:app-core` (nx tag constraint in `eslint.config.mjs`); `libs/core` may not import react, react-dom, ink, electron or `@kirby/app-core`; and the desktop renderer may not import `@kirby/core` for its values, because it reaches `node:fs`. Neither barrel re-exports the other, so the layer a symbol comes from is visible at its import site. The plan store is the worked example of where the line falls: the store is in core, its `useSyncExternalStore` binding is in app-core.

- **Where a sequence lives is not yet settled everywhere — check before adding one.** The desktop host was forced into a backend by Electron's sandbox (no Node in the renderer, so everything crosses `host/contract.ts`); the TUI never was, so some of its equivalent logic still sits inside React hooks and is duplicated rather than shared. `openRepo` (desktop `host/services/repo.ts`) does what the TUI's `useSessionManager` mount does: `autoDetectProjectConfig`, `setWorktreeResolver(createTemplateResolver(worktreePath))` (reset when unset), `applySessionBackend(config)`; `main.ts` runs `probeTmuxAvailability()` once at startup. Worktree removal is written twice — the TUI's `performDelete` triple (kill session → remove worktree → delete branch) and desktop `host/services/worktrees.ts` — and the two have already diverged: only the desktop calls `killPersistedTmuxSession`, so with the tmux backend the TUI can delete a worktree out from under a persisted session. Session launch resolves the worktree via `createWorktree` (directory-name keyed, tolerant of a switched branch), reads config from the **repo root** (per-project config is cwd-hash keyed), and never respawns a live session. Force-remove is only offered for the TUI's two overridable safety reasons ('uncommitted changes', 'not pushed to upstream'). Draft posting is one comment per `postReviewComments` call so a mid-batch failure can't reset already-live comments back to draft. When you touch one of these, put the sequence in `@kirby/core` and have both shells call it, rather than adding a third copy.

## PR Reviews via CLI

When reviewing a pull request, use `gh` CLI — not the workflow-manager agent.

### Gathering info

- `gh pr view <number> --json title,body,files,headRefOid,headRepositoryOwner,headRepository` — get metadata and the commit SHA needed for the review API
- `gh pr diff <number>` — get the full diff (pipe to a file or read tool if large)
- `gh repo view --json nameWithOwner` — get the `owner/repo` for API calls

### Posting inline review comments

Use the GitHub API directly to post a review with inline comments:

```bash
cat <<'EOF' | gh api repos/OWNER/REPO/pulls/NUMBER/reviews --input -
{
  "commit_id": "<head SHA from gh pr view>",
  "body": "Overall review summary here.",
  "event": "COMMENT",
  "comments": [
    {
      "path": "relative/file/path.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "Comment on the new code at this line."
    }
  ]
}
EOF
```

- `line` is the line number in the **new version** of the file (right side of the diff)
- `side: "RIGHT"` targets the new code; use `"LEFT"` to comment on removed lines
- `event` can be `"COMMENT"`, `"APPROVE"`, or `"REQUEST_CHANGES"`

### Changing review status without duplicating comments

To set "Changes requested" after already posting inline comments, submit a **separate review with no `comments` array** — just `body` and `event`:

```bash
cat <<'EOF' | gh api repos/OWNER/REPO/pulls/NUMBER/reviews --input -
{
  "commit_id": "<head SHA>",
  "body": "Requesting changes — see inline comments.",
  "event": "REQUEST_CHANGES"
}
EOF
```

This adds the blocking status without duplicating any inline comments.

### Things to watch out for

- **Always prefix AI-generated comments** with "AI generated:" so it's clear they don't come directly from the repo owner
- **Don't use `gh pr review`** for inline comments — it only supports a single body comment, not per-line annotations
- **Line numbers come from the new file**, not diff positions — count from the `@@` hunk headers to get them right
- **Heredoc quoting matters** — use `<<'EOF'` (quoted) to prevent shell expansion inside the JSON body

## Publishing to NPM

Two packages ship from this repo, both beta-only and published manually from a local machine — there is no CI workflow for either:

| Package                                | Source         | Users install                                        |
| -------------------------------------- | -------------- | ---------------------------------------------------- |
| `@hermannbjorgvin/kirby` (TUI)         | `apps/cli`     | `npm install -g @hermannbjorgvin/kirby@beta`         |
| `@hermannbjorgvin/kirby-desktop` (GUI) | `apps/desktop` | `npm install -g @hermannbjorgvin/kirby-desktop@beta` |

**They share one version number.** Both are front-ends over the same core and release together, so a user can compare the two numbers and know what they have. `scripts/shared-version.mjs` enforces it: each package's publish-prep calls `assertVersionsMatch()` and refuses to prepare a mismatched pair.

### One-time setup

- `npm login` on your machine. `npm whoami` must resolve to an account that owns the `@hermannbjorgvin` scope.

### How to publish a beta version

1. Bump the version in **both** `apps/cli/package.json` and `apps/desktop/package.json` to the same value. Every version must end in `-beta.N`:

   - Patch: `0.0.1-beta.2` or `0.0.2-beta.1`
   - Minor: `0.1.0-beta.1`
   - Major: `1.0.0-beta.1`

2. Commit the bump:

   ```bash
   git commit apps/cli/package.json apps/desktop/package.json -m "chore: bump kirby to 1.0.0-beta.5"
   ```

3. Publish:

   ```bash
   npx nx run cli:publish
   npx nx run desktop:publish
   ```

   `cli:publish` runs `build` → `prepare-publish.mjs` → `npm publish --tag beta apps/cli/dist`; `desktop:publish` runs `build` → `prepare-install.mjs` → `npm publish --tag beta apps/desktop/dist`. The `--tag beta` flag keeps releases off the default `latest` dist-tag so users must explicitly opt in with `@beta`.

### Desktop packaging notes

`prepare-install.mjs` writes `dist/package.json` (scoped name, `publishConfig.access: public` — a scoped package publishes restricted otherwise), copies the launcher, `apps/desktop/README.md` and the repo `LICENSE` into `dist/` (npm only picks up a README from the pack root), marks the launcher executable, and packs a tarball for `install-global`.

The published package carries two runtime deps: `electron` (the binary the launcher spawns, ~190 MB on install) and `node-pty`. node-pty is N-API based, so its binary loads under Electron with no `@electron/rebuild` step on the user's machine — but it ships prebuilds for macOS and Windows only, so **Linux installs compile it** and need `build-essential` + `python3`. Windows users are pointed at WSL, where the Linux path applies.

### Build details

`npx nx build cli` bundles all workspace libs (`@kirby/*`) and npm deps into a single `apps/cli/dist/main.js` with a `#!/usr/bin/env node` shebang. Only `node-pty` is kept external (it's a native module).

The build copies the source `apps/cli/package.json` into `dist/` via its `assets` config — that copy is fine for `install-global` but carries workspace `@kirby/*` deps that don't exist on the npm registry. So `apps/cli/scripts/prepare-publish.mjs` rewrites `dist/package.json` just before publishing, keeping only the fields needed for npm (name, version, bin, etc.) and `node-pty` as the sole runtime dependency.
