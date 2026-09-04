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
so a capture needs no token, no network and no real agent. The TUI demo
records through the same wterm bridge `cli-e2e` uses, since an Ink app
on a PTY has no window to grab, and `theme-slider.py` composites the two
hero stills into the light/dark wipe. Recordings land in the gitignored
`docs/media/raw/`; a failed take leaves the frame it died on there.

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

**Write file globs unanchored, or a whole project silently opts out.**
`apps/cli-e2e`, `apps/desktop-e2e` and `apps/cli-wterm-host` build
their configs by spreading the root one, and ESLint **re-bases a
relative glob onto the config that spreads it** — so a block scoped
`files: ['apps/**/*.ts']` becomes `apps/cli-e2e/apps/**/*.ts` there and
matches nothing. Every size budget and the entire type-aware block
therefore did not apply to ~8k lines of Playwright suite, including
`no-floating-promises`, in the code most made of promises. The globs
are `**/*.{ts,tsx}` and `**/src/**/*.{ts,tsx}` now, which survive the
re-basing. Blocks meant for one project (the Ink rules, the renderer
import rules) stay anchored on purpose — there, matching nothing
elsewhere is the point. Check a new block with
`cd apps/desktop-e2e && npx eslint --print-config <file>` rather than
by reading the glob.

**Warnings fail the build — check exit codes, not output.** The
inferred lint target is `eslint .`, which exits 0 with warnings
present, so for a long time every budget above was advisory and a
`nx run-many -t lint` exit code proved nothing. `nx.json`
`targetDefaults.lint` now overrides the command to
`eslint . --max-warnings 0` (the inferred per-project `cwd` survives
the override, which is what makes it correct), and `lint-staged` runs
`eslint --fix --max-warnings 0`. Verified by mutation: a
complexity-21 function added to a `desktop-e2e` file — a spot that
previously escaped both the glob and the exit code — fails the target
with exit 1.

**Size and shape budgets — warnings, and a ratchet.** `max-lines` 300
(blank lines and comments excluded), `complexity` 12, `max-depth` 4 at
error. These are set where they bound what gets _added_ rather than
where they would be comfortable: a file grows past 300 lines and a
function past 12 branches one plausible edit at a time, and nobody
reviews that as growth.

**Every list is empty, and 12 was reached by refactoring rather than
by exempting.** All 47 functions that stood between 18 and 12 came
down — 31 to reach 13, 16 more to reach 12 — and not one of them
needed a carve-out. The metric turned out to be a good detector here:
in every case it was pointing at a function doing two jobs, a lookup
table written as an if-chain, or a component holding a section that
wanted to be its own component. Nothing has yet been found that is
irreducibly branchy, so **reach for the refactor before reaching for
an exception**, and if you do add one, say what makes that function
different from these 47.

The next notch is a real decision rather than a cleanup, and the
numbers are measured: of 1676 functions, 1257 score under 5, and the
count over a candidate ceiling is 15 at 11, 46 at 10, 100 at 8 and 153
at 7. Below 11 it starts reporting ordinary components with a handful
of conditional renders, where the split stops paying for itself. Of
341 files, 3 exceed 300 (all three the deliberately exempted ones), 18
exceed 250 and 41 exceed 200. Two files carry a 900-line ceiling
instead
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
Joined later, each measured at or near zero first so they only bound
what gets added: `no-unsafe-call` and `no-unsafe-argument` (the last
step of an `any` escaping a `JSON.parse` and being invoked),
`consistent-type-exports`, `prefer-promise-reject-errors`,
`return-await` (`in-try-catch`: returning a promise from inside `try`
escapes the `catch` written to handle it) and `no-deprecated`.

**React Compiler blind spots — `react-hooks/todo` is on for a reason.**
react-hooks v7 is React Compiler analysis wearing a lint plugin, and
when the compiler cannot lower a function it **abandons it**: every
other rule in the plugin goes quiet for that file, reporting nothing no
matter what the code does. `recommended` leaves the one rule that says
so (`todo`) off, which is how two render-phase ref writes sat unflagged
under `react-hooks/refs` set to `error` — copy either line into a fresh
file and it errors instantly. `try/finally` is the common trigger (also
a conditional inside `try/catch`, and some member-expression
reorders). Six files are affected and are **listed by name in
`eslint.config.mjs`** with the rule turned off, because the code is
right as written — `finally` is how you release a loading flag — and a
list is more honest than a refactor. The rule stays on everywhere else,
so a _new_ file entering that state gets reported instead of joining
the list quietly. `react-doctor` is not compiler-powered and is the way
to check what those six actually contain.

Note the same shape of gap in `react/no-array-index-key`: it only sees
an index arriving as a `.map()` parameter, so a hand-rolled loop
counter used as a key reads as an ordinary variable and passes. A clean
run means "no obvious ones".

**Ink rules** (`tools/eslint-plugin-ink.mjs`, TUI only). Ink enforces
its layout contract at _runtime_ by throwing, so a bad component
type-checks, builds, ships, and dies the first time that branch
renders. `no-raw-text` and `no-layout-inside-text` are clean today and
exist to stay that way; `no-bare-process-exit` is off for `main.tsx`
and `commands/**`, which legitimately own exiting. The rules resolve
components through their import, so a renamed `Text` still counts and a
non-Ink `Box` does not.

These are local because the obvious dependency still does not cover
them. `eslint-plugin-react-doctor` ships 22 `ink-*` rules; at **0.9.12
two of them work** (`ink-no-raw-text`, `ink-no-layout-inside-text`),
which is a change from when this was last measured and they reported
nothing at all. Against one file violating three rules, scoped so both
plugins' globs apply, ours reports 3 and react-doctor 2 — it misses
`ink-no-bare-process-exit` — and our messages name the runtime failure
rather than the rule. Keep the local plugin; re-measure rather than
assuming either direction.

The rest of that plugin remains a poor fit: of 593 reports from
`recommended` (581 rules) across this codebase, **65% is two rules
premised on React Compiler**, which we do not run — 206
`react-compiler-no-manual-memoization` and 179
`jsx-no-new-function-as-prop` — and 83% once `jsx-max-depth` and
`only-export-components` are added. The residue is worth reading
periodically, though: it is not compiler-powered, so it sees into the
blind spots below, and it found the two live render-phase ref writes
plus a derived-`useState` there.

**Test hygiene.** `@vitest/eslint-plugin` on `*.spec.*`;
`eslint-plugin-playwright` covers the e2e suites from their own
configs. `vitest/no-focused-tests` is the one that matters — a stray
`.only` leaves CI green while running one test, which is worse than a
red build because nothing signals it.

Everything except `max-depth`, `no-param-reassign` and the Ink and
vitest rules is a **warning** — which, now that the target passes
`--max-warnings 0`, is a distinction in reporting rather than in
consequence. The app predated the budgets, so the point was a downward
ratchet rather than a wall — and the ratchet has arrived. Current
standing, across all 17 projects (`nx run-many -t lint --all`): **0
errors, 0 warnings**. Measure with `--all`: the three e2e suites lint
under their own Playwright configs and are invisible otherwise, which
is how a smaller number once read as clean.

Zero is now the baseline, so a warning is a regression and there is no
backlog to hide in. **A `PostToolUse` hook holds it there**:
`.claude/settings.json` runs `tools/lint-hook.mjs` after every
Write/Edit, and a file left with any problem blocks the edit with
ESLint's own output. It lints from the directory whose config owns the
file, not from the repo root — `apps/cli-e2e`, `apps/desktop-e2e` and
`apps/cli-wterm-host` each carry their own flat config, and ESLint 9
loads config from the working directory, so a root-cwd run reports "No
issues found" on an e2e file that genuinely violates its own Playwright
rules. It stays out of the way otherwise: a non-JS path, a file already
deleted, one outside the repo, or ESLint itself failing to run all pass
the edit through, because none of those is the edit's fault. Two of the categories that got it there were not
cosmetic, and are worth knowing before reintroducing the pattern:

- **`no-floating-promises` was a crash.** Nothing awaits
  `asyncOps.run` and nothing installs an `unhandledRejection` handler,
  so a git call rejecting inside one ended the process. `run` reports
  failures through `setOperationErrorHandler` — `SessionProvider`
  points it at the toast rail — and never rejects. Do not restore a
  version that rejects, and do not silence this rule with `void` where
  the rejection has nowhere to go.
- **`playwright/no-wait-for-timeout`** is off for
  `apps/cli-e2e/src/setup/waits.ts` alone. Every fixed wait in the TUI
  suite goes through `settleFor(page, ms, reason)`, whose reason
  becomes a test step. Most waits there are load-bearing — proving a
  toast never fires, outlasting the resize debounce, or letting Ink's
  `useInput` see a filter its closure captured a render ago — so
  reach for an auto-waiting assertion first and `settleFor` only for
  those cases.

**Inline suppressions are down to six, each with a `--` rationale**:
four `no-control-regex` (a terminal escape sequence starts with the
byte the rule flags), one `exhaustive-deps` in `useReviewComments` (a
revision counter is the change signal for a file on disk, and there is
no snapshot to derive from), and one `react-hooks/incompatible-library`
in `VirtualDiffList` (the virtualizer hands back methods, and this
build does not run React Compiler anyway). Anything new should clear
the same bar: say why the rule cannot apply here, not that it is
inconvenient.

Two rule-level notes worth keeping. `react-hooks` v7 is
compiler-powered, so a suppression can **hide analysis of the whole
hook** — removing the render-phase ref writes in `useMergedBranches`
surfaced a synchronous `setState` nobody had seen. And an inline
`eslint-disable` naming a plugin rule is a **hard error in the
pre-commit hook**, which runs eslint without the Playwright plugin
registered; scope those in the project's `eslint.config.mjs` instead.

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
  src/models/                    — Pure view-models behind those components (sidebar-layout, comment-card-model, pr-badge-model)
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
    components/                  — TitleBar, StatusBar, CommandPalette, sidebar/, editor/ (tabs), settings/, terminal/
    components/review/           — the review workspace shell: PrWorkspace, PrHeader, ReviewRail(+Sections), ContentPane, OverviewPane, PlanPane/PlanControls
    components/review/comments/  — reviewer threads: ThreadCard, CommentsList, CommentMarkdown, ConversationPanel…
    components/review/diff/      — the viewer: DiffPane, VirtualDiffList, diff-rows, FileTree, SnippetView…
    components/review/drafts/    — the agent's drafts + walkthrough: DraftCard, DraftEditor, ReviewStepper…
    lib/                         — grouped by subsystem, not one flat folder (see below)
    lib/data/                    — queries.ts (TanStack Query over window.kirby), mutations.ts, query-keys.ts
    lib/diff/                    — diff-model.ts (fold, split pairing), diff-virtual.ts, word-diff.ts, highlight.ts, thread-model.ts
    lib/tabs/                    — tabs-model.ts (pure reducer: preview/pinned, `sync-items`), tabs.tsx, use-close-tabs.tsx
    lib/plan/                    — plan-model.ts (rows, numbering), plan.ts, use-plan-checkout.ts
    lib/review/                  — review-model.ts (what the workspace shows), review-verdict.ts, severity.ts, use-comment-navigator.ts
    lib/sidebar/                 — sidebar-model.ts, sidebar-row-menu.ts, attention.ts
    lib/*.ts                     — what belongs to no subsystem: utils, theme, terminal-grid, content-key, settings-*
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
- **A fresh git worktree needs more than the root `node_modules`.** Git
  worktrees carry no untracked files, so a new one has no dependencies
  at all, and until it does, `nx` resolves the _other_ checkout's libs
  and you are testing code you did not change. `npm install` works but
  is slow; `cp -al <other-worktree>/node_modules ./node_modules` is the
  fast path — a **hardlink** copy, never a symlink, because the
  `@kirby/*` entries are relative symlinks that only resolve correctly
  when copied. That alone is still not enough: npm keeps
  version-conflicting deps in _per-workspace_ `node_modules` outside the
  root (today `libs/review-comments/node_modules`, which holds
  `wrap-ansi@9` against the root's untyped `wrap-ansi@7`, and
  `apps/desktop/node_modules`). Miss those and `tsc` reports one
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
  repo-qualified for the same reason). `sync-items` reconciles only the
  tabs of the repo it is handed; a foreign tab must never be re-keyed,
  pinned or collapsed by a poll about somewhere else, and
  `tabs.properties.spec.ts` asserts that as an invariant over arbitrary
  sequences. `TabsProvider` sits above the repo gate in `App.tsx` —
  `Workspace` is keyed by repo and remounts, so anything below it is
  destroyed on a switch.

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
  ref locks; a fetch of the same refs (or of everything) younger than
  the refresh interval is reused rather than repeated. The merge check
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
  decorates `getSidebarSnapshot` from `babysatStatuses`, stops the
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

- **Write the body as a Conventional Comment and sign it at the end** — `<label> [decorations]: <subject>`, a blank line, then the discussion, closing with `_Posted via [Kirby](https://github.com/HermannBjorgvin/Kirby) by an agent_` after a `---`. Same shape Kirby's own poster emits (`libs/review-comments/src/lib/conventional.ts`), so a reader can still tell at a glance that a machine wrote it — just not before they can tell what it says
- **Don't use `gh pr review`** for inline comments — it only supports a single body comment, not per-line annotations
- **Line numbers come from the new file**, not diff positions — count from the `@@` hunk headers to get them right
- **Heredoc quoting matters** — use `<<'EOF'` (quoted) to prevent shell expansion inside the JSON body

## Publishing to NPM

Two packages ship from this repo, both beta-only and published manually from a local machine — there is no CI workflow for either:

| Package                                | Source         | Users install                                        |
| -------------------------------------- | -------------- | ---------------------------------------------------- |
| `@hermannbjorgvin/kirby` (TUI)         | `apps/cli`     | `npm install -g @hermannbjorgvin/kirby@beta`         |
| `@hermannbjorgvin/kirby-desktop` (GUI) | `apps/desktop` | `npm install -g @hermannbjorgvin/kirby-desktop@beta` |

**Users need both, and packaging cannot fix that — it is documented
instead.** A review agent records what it finds by running `kirby util
add-comment`, which ships only in the CLI package, so agent-drafted
reviews do not work on a desktop-only install. Both READMEs say so.
Two things were measured before settling for documentation, so nobody
re-derives them: npm does **not** put a dependency's `bin` on the
user's PATH for a global install (only the named package's bins are
linked — the dependency's is not installed anywhere in the prefix), so
having the desktop depend on the CLI achieves nothing; and two global
packages declaring the same bin name **hard-error** on the second
install ("Remove the existing file and try again"), so giving the
desktop its own `kirby` bin would make installing both impossible in
either order. The remaining option, if this ever becomes worth it, is
for the desktop to ship a private `kirby` beside its own binary and
prepend that directory to the PATH of the sessions it spawns — the
agent's environment, never the user's. `apps/cli/src/commands/util.ts`
is 110 lines whose only import is `@kirby/review-comments`, which the
desktop already bundles.

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

   `cli:publish` runs `build` → `prepare-publish.mjs` → `npm publish --tag beta apps/cli/dist` → `dist-tag-latest.mjs`; `desktop:publish` runs `build` → `prepare-install.mjs` → `npm publish --tag beta apps/desktop/dist` → `dist-tag-latest.mjs`.

   **Each release carries both `beta` and `latest`.** A single publish can set only one tag, so the publish sets `beta` — the install path both READMEs document, live the moment the version exists — and `scripts/dist-tag-latest.mjs` moves `latest` onto the same version immediately after. Without that second call npm leaves `latest` behind, and a prerelease version is never resolved by a plain `npm install -g <pkg>`, so anyone omitting `@beta` would silently get an older release. The script takes the version from `assertVersionsMatch()` rather than an argument, so it cannot tag a version that was never published.

### Desktop packaging notes

`prepare-install.mjs` writes `dist/package.json` (scoped name, `publishConfig.access: public` — a scoped package publishes restricted otherwise), copies the launcher, `apps/desktop/README.md` and the repo `LICENSE` into `dist/` (npm only picks up a README from the pack root), marks the launcher executable, and packs a tarball for `install-global`.

The published package carries two runtime deps: `electron` (the binary the launcher spawns, ~190 MB on install) and `node-pty`. node-pty is N-API based, so its binary loads under Electron with no `@electron/rebuild` step on the user's machine — but it ships prebuilds for macOS and Windows only, so **Linux installs compile it** and need `build-essential` + `python3`. Windows users are pointed at WSL, where the Linux path applies.

### Build details

`npx nx build cli` bundles all workspace libs (`@kirby/*`) and npm deps into a single `apps/cli/dist/main.js` with a `#!/usr/bin/env node` shebang. Only `node-pty` is kept external (it's a native module).

The build copies the source `apps/cli/package.json` into `dist/` via its `assets` config — that copy is fine for `install-global` but carries workspace `@kirby/*` deps that don't exist on the npm registry. So `apps/cli/scripts/prepare-publish.mjs` rewrites `dist/package.json` just before publishing, keeping only the fields needed for npm (name, version, bin, etc.) and `node-pty` as the sole runtime dependency.
