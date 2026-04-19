import { test, expect } from '@microsoft/tui-test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { MAIN_JS, cloneTestRepoWithAuth } from './setup/app.js';

// Covers the Step 16 external store for `reviewSessionStarted`.
// Once a user picks "Start review" on a review-PR row, the PR's id
// lands in the module-local store; any subsequent navigation back to
// that PR row resolves to terminal mode instead of pr-detail. The
// store survives the key={itemKey} remount that the rest of pane
// state gets on item change — that's the specific refactor risk this
// test guards.
//
// Uses fixture PR #37 (`fixture/add-color-support`) from the shared
// test repo — it's approved by the test-runner account so it shows
// up in the "Approved by You" section with a deterministic title.

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-review-persist-clone-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'kirby-review-persist-home-'));
const logFile = join(tmpdir(), 'kirby-review-persist.log');
registerCleanup(cloneDir);
registerCleanup(fakeHome);

if (hasGhToken) {
  cloneTestRepoWithAuth(cloneDir);

  const kirbyDir = join(fakeHome, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(
    join(kirbyDir, 'config.json'),
    JSON.stringify({
      keybindPreset: 'vim',
      // Short poll so PRs appear promptly.
      prPollInterval: 5_000,
    }),
    'utf-8'
  );
}

test.use({
  rows: 40,
  columns: 120,
  program: { file: 'node', args: [MAIN_JS, cloneDir] },
  env: {
    ...process.env,
    HOME: fakeHome,
    TERM: 'xterm-256color',
    KIRBY_LOG: logFile,
  },
});

// PR #37 title — the unified sidebar truncates at the configured
// width, but this prefix stays on one line at 120 cols.
const PR_37_TITLE = 'Add color support for tile values';

// TODO: this test needs rework. The navigation loop relies on pressing
// `j` N times to land on PR #37, but the sidebar ordering depends on
// kirby-test-runner's live review state and the initial cursor
// position — it routinely overshoots and starts a review session on
// a different PR (#39 in the run this was disabled from), after which
// the `return to PR #37` half of the test can't find its target. A
// robust rewrite should:
//   - observe the currently-selected row before starting review,
//     and use whatever PR that is as the target throughout,
//   - OR scroll sidebar-by-row with assertions between each step
//     rather than a blind N-press loop.
// Skipping via `false` keeps the file compiling without adding a
// test.skip helper. The `reviewSessionStarted` external store is
// still covered by the unit spec in apps/cli/src/hooks/usePaneReducer.spec.ts
// (via the getReviewStartedSnapshot/setReviewSessionStartedExternal
// module-level pair) — just not end-to-end.
test.when(
  hasGhToken && false,
  'review session started on a PR persists terminal mode after navigation',
  async ({ terminal }) => {
    // 1. Wait for Kirby to start and PR data to land.
    await expect(terminal.getByText('Kirby', { strict: false })).toBeVisible();
    await expect(
      terminal.getByText('Approved by You', { strict: false })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      terminal.getByText(PR_37_TITLE, { strict: false })
    ).toBeVisible({ timeout: 10_000 });

    // 2. Navigate to PR #37's row. The initial selection lands on the
    //    first sidebar item, which is typically the first session (or
    //    a review-PR row if there are no sessions). Press `j` until
    //    the selection marker sits on PR #37's title.
    const pr37 = sidebarLocator(terminal, PR_37_TITLE);
    for (let i = 0; i < 12; i++) {
      // Five non-PR rows at most (sections + other PRs); twelve hops
      // is a safe ceiling.
      terminal.write('j');
      await new Promise((r) => setTimeout(r, 200));
      try {
        await expect(pr37.selected()).toBeVisible({ timeout: 300 });
        break;
      } catch {
        // Not there yet — keep going.
      }
    }
    await expect(pr37.selected()).toBeVisible({ timeout: 5_000 });

    // 3. Enter → review confirm modal ("Confirm Review" is the pane
    //    title set by getPaneTitle for reviewConfirmActive).
    terminal.write('\r');
    await expect(
      terminal.getByText('Confirm Review', { strict: false })
    ).toBeVisible({ timeout: 5_000 });

    // 4. Move to option 1 ("Start review") and submit. Option 0 is
    //    "Start session" (plain AI), option 1 is "Start review" —
    //    the one that calls setReviewSessionStarted.
    terminal.write('j');
    await new Promise((r) => setTimeout(r, 200));
    terminal.write('\r');

    // 5. Review confirm clears and pane switches to terminal mode.
    //    The `claude` binary isn't installed in CI, so the spawned
    //    shell exits almost immediately — but setPaneMode('terminal')
    //    and setReviewSessionStarted both run before the process
    //    dies, so the store is populated and the pane title is in
    //    terminal mode regardless.
    await expect(
      terminal.getByText('Confirm Review', { strict: false })
    ).not.toBeVisible({ timeout: 10_000 });

    // 6. Navigate away from the PR row. Any other row will do — the
    //    test needs _some_ sibling so the sidebar `j`/`k` change
    //    re-triggers the key={itemKey} remount on MainTabBody.
    terminal.write('k');
    await new Promise((r) => setTimeout(r, 400));
    terminal.write('k');
    await new Promise((r) => setTimeout(r, 400));

    // 7. Navigate back to PR #37.
    for (let i = 0; i < 12; i++) {
      terminal.write('j');
      await new Promise((r) => setTimeout(r, 200));
      try {
        await expect(pr37.selected()).toBeVisible({ timeout: 300 });
        break;
      } catch {
        // keep searching
      }
    }
    await expect(pr37.selected()).toBeVisible({ timeout: 5_000 });

    // 8. Assert: the pane is STILL in terminal mode. The review-pr
    //    default would be pr-detail; if the external store lost the
    //    PR id across the remount, `defaultPaneMode` would return
    //    'pr-detail' and the pane title would become 'Pull Request'.
    //    So its ABSENCE is the load-bearing assertion here.
    await expect(
      terminal.getByText('Pull Request', { strict: false })
    ).not.toBeVisible({ timeout: 3_000 });
  }
);
