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

| PR   | Branch                      | Title                                  | CI     | Review (by kirby-test-runner)         |
| ---- | --------------------------- | -------------------------------------- | ------ | ------------------------------------- |
| #37  | `fixture/add-color-support` | Add color support for tile values      | passes | Approved                              |
| #38  | `fixture/add-undo-feature`  | Add undo feature with history stack    | passes | Changes requested (3 inline comments) |
| #39  | `fixture/add-ai-solver`     | Add AI solver for auto-play mode       | fails  | Approved (1 suggestion comment)       |
| #322 | `fixture/outdated-thread`   | Outdated thread fixture (do not merge) | n/a    | 1 inline comment, marked outdated     |

These PRs are permanent fixtures — tests only read them, never modify. The test repo contains a C 2048 game project.

PR #322 is an exception in shape: it has two commits where the second
rewrites the function the review comment was anchored to, so GitHub
flags the thread `isOutdated: true` with `line: null` and only
`originalLine` set. Used by `outdated-thread.test.ts` to verify the
diff viewer renders outdated threads inline at their `originalLine`
instead of dropping them into the "comments on lines not in diff" tail.
The fixture was authored by HermannBjorgvin (not kirby-test-runner) so
its presence in the PR list won't change `reviews-fixture.test.ts`'s
existing categorization.

**CI pipelines:**

- **CI** (`.github/workflows/ci.yml`) — runs `nx affected -t lint test build typecheck e2e`. Runs `npx playwright install --with-deps chromium` before `nx affected` (needed for `cli-e2e`). Uploads `apps/cli-e2e/test-output/` as an artifact on failure. Integration tests skipped (no `GH_TOKEN`).
- **Integration Tests** (`.github/workflows/integration.yml`) — runs `npx nx e2e:integration cli-e2e` with `GH_TOKEN` from the `INTEGRATION_TEST_PAT` secret. Triggers on PRs, pushes to master, and manual dispatch. Uses `concurrency` with `cancel-in-progress: false` because the test repo is shared state.

## Project Structure

```
apps/cli/                        — Ink TUI application (ESM, React 19)
  src/main.tsx                   — Entry point, root component
  src/pty-registry.ts            — PTY session lifecycle (spawn, get, kill)
  src/input-handlers.ts          — Shared input types (NavValue, etc.) + settings/controls handlers
  src/keybindings/               — Customizable keybinding system
    registry.ts                  — Action catalog, presets (Normie/Vim), ActionId type
    resolver.ts                  — matchesKey, resolveAction, findConflict, descriptorFromKeypress
    hints.ts                     — Human-readable key display strings
    controls-data.ts             — Controls panel data logic (buildControlsRows, getBindingRows)
  src/components/                — Shared components (SidebarLayout, TerminalView, TabBar, StatusBar, etc.)
  src/screens/main/              — Main tab (sidebar, diff, branch picker, confirm dialogs)
  src/screens/reviews/           — Reviews tab (DiffFileList, DiffViewer, ReviewDetailPane)
  src/context/                   — React contexts (AppState, Session, Config, Keybind, Layout, Sidebar)
  src/hooks/                     — Custom hooks (useTerminal, useDiffData, useSettings)
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
libs/worktree-manager/           — Git worktree and branch operations
  src/lib/worktree.ts            — Worktree CRUD, branch utils, conflict checks
libs/terminal/                   — PTY session + terminal emulation (node-pty + @xterm/headless)
  src/lib/pty-session.ts         — node-pty wrapper
  src/lib/terminal-emulator.ts   — @xterm/headless wrapper with ANSI rendering
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
