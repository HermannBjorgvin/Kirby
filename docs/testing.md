# Testing

- **TDD for libraries:** `worktree-manager` (worktree.ts) — mock `exec`, test parsing and CRUD logic.
- **Ink components:** Use `ink-testing-library` to verify text content + keyboard navigation. No real TTY needed.
- **Manual testing for:** ANSI/visual rendering, PTY input forwarding, anything involving real terminal interaction.
- **Run tests via NX:** `npx nx test worktree-manager`
- **Dev run:** `npx nx serve cli` (rebuilds stale lib deps, then runs via tsx)

## Desktop Tests (`apps/desktop`, `apps/desktop-e2e`)

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

## E2E Tests (Playwright + wterm)

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

## Interactive QA (Playwright MCP + shared Chrome)

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

## Integration Tests

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
