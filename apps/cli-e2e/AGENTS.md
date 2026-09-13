# apps/cli-e2e — TUI end-to-end tests

Playwright drives Kirby in headless Chromium through `apps/cli-wterm-host`.
The fixture (`src/fixtures/kirby.ts`) gives each test a temp git repo, an
isolated HOME with an optional `.kirby/config.json` (`test.use({ kirbyConfig })`),
`POST`s `/spawn`, waits for `Kirby` to paint, and yields
`{ term, repoPath, homeDir }`. `term` exposes `getByText`, `press`, `type`,
`write` and `resize`. Full infrastructure notes: `docs/testing.md`.

- Every test's config writes `terminalBackend: 'pty'`; pass
  `terminalBackend: undefined` (`UNSET_BACKEND`) for the unconfigured state.
  Without that, a machine with tmux would leak one live agent per test.
- Tag live-GitHub suites `@integration`; offline runs exclude them. They need
  `GH_TOKEN`. Fixture-reading tests leave permanent PRs unchanged, but
  `merge-auto-delete.test.ts` creates branches and PRs and merges them in the
  test repository. See `docs/testing.md` for credentials and fixture details.
- Fixed waits go through `src/setup/waits.ts` `settleFor(page, ms, reason)`;
  `playwright/no-wait-for-timeout` is off for that file alone. Reach for an
  auto-waiting assertion first.
- `page.keyboard.press` returns before wterm's DOM updates: pace tight
  press-then-check loops with `locator.waitFor`, and wait for the branch
  picker to close before the next `c` in sequential creates.
- Sidebar icon assertions: `src/setup/sidebar.ts` `sidebarLocator`.
- `src/setup/tmux.ts` proves its socket dir is a fixture temp home before it
  lists or kills anything.
- Failures keep trace, screenshot and video under `test-output/`; open with
  `npx playwright show-trace <trace.zip>`. `error-context.md` is more greppable
  than the PNG. `outputDir` and the nx target's `outputs` must agree or nx
  caches stale artifacts.
- Interactive QA: `npx nx serve cli-wterm-host`, then one Chrome on CDP port
  9222 with the `.vscode/chrome` profile (VS Code F5 or the command in
  `docs/testing.md`); the repository-configured Playwright MCP attaches to it.
