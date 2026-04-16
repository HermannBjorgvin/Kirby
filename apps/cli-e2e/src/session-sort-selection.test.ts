import { test, expect } from '@microsoft/tui-test';
import type { Terminal } from '@microsoft/tui-test/lib/terminal/term.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO } from './setup/constants.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
const mainJs = resolve('../cli/dist/main.js');

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-sort-clone-'));
const fakeHome = mkdtempSync(join(tmpdir(), 'kirby-sort-home-'));
const logFile = join(tmpdir(), 'kirby-sort-debug.log');
registerCleanup(cloneDir);
registerCleanup(fakeHome);

if (hasGhToken) {
  // 1. Clone sandbox repo (all branches needed for branch picker)
  //    Use HTTPS URL directly — gh repo clone may default to SSH which can be blocked.
  const token = process.env.GH_TOKEN;
  execSync(
    `git clone "https://x-access-token:${token}@github.com/${TEST_REPO}.git" "${cloneDir}"`,
    { stdio: 'pipe' }
  );

  // 2. Configure git identity
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });

  // 4. Write global config with aiCommand: "cat" to avoid needing claude binary
  const kirbyDir = join(fakeHome, '.kirby');
  mkdirSync(kirbyDir, { recursive: true });
  writeFileSync(
    join(kirbyDir, 'config.json'),
    JSON.stringify({ aiCommand: 'cat', keybindPreset: 'vim' }),
    'utf-8'
  );
}

// ── Helper: create a session via the branch picker UI ──────────────
async function createSessionViaBranchPicker(
  terminal: Terminal,
  branchFilter: string,
  waitFor: RegExp
) {
  // Open branch picker
  terminal.write('c');
  await expect(
    terminal.getByText('Branch Picker', { strict: false })
  ).toBeVisible();

  // Type the filter text
  terminal.write(branchFilter);

  // Wait for the filter to be reflected in the branch picker title.
  // The title renders as "Branch Picker / {filter}" when a filter is active.
  // This is the only reliable signal that React has committed the filter state,
  // so the filtered branch list is correct when Enter is pressed.
  await expect(
    terminal.getByText(`/ ${branchFilter}`, { strict: false })
  ).toBeVisible();

  // Press Enter to create
  terminal.write('\r');

  // Wait for the session's row to appear in the sidebar with ANY running/
  // selected-state icon preceding the title. The caller passes a regex like
  // /[◉◎●○].*Title/ — we don't pin a specific icon because:
  //   - `◉` / `◎` render when the row is selected (fresh sessions auto-select)
  //   - `●` / `○` render once the next session is created and steals focus
  //   - The PTY may or may not be running yet (running vs stopped).
  // All four icons are valid "session exists" signals.
  await expect(terminal.getByText(waitFor, { strict: false })).toBeVisible({
    timeout: 15_000,
  });
}

// ── Configure tui-test ─────────────────────────────────────────────
test.use({
  rows: 60,
  columns: 120,
  program: {
    file: 'node',
    args: [mainJs, cloneDir],
  },
  env: {
    ...process.env,
    HOME: fakeHome,
    TERM: 'xterm-256color',
    KIRBY_LOG: logFile,
  },
});

// ── Tests ──────────────────────────────────────────────────────────

test.when(
  hasGhToken,
  'selects correct session after branch picker creation in sorted sidebar',
  async ({ terminal }) => {
    // 1. Wait for Kirby to render
    await expect(
      terminal.getByText('Approved by You', { strict: false })
    ).toBeVisible();

    // 2. Create sessions in an order that DIFFERS from PR-sorted order.
    //    Sorted order (desc PR ID): ai-solver(#39), undo(#38), color(#37)
    //    Creation order:            color(#37), ai-solver(#39), undo(#38)
    //
    //    This makes the raw list indices differ from sorted indices:
    //      Raw (creation order): [color=0, ai-solver=1, undo=2]
    //      Sorted (desc PR):    [ai-solver=0, undo=1, color=2]
    //
    //    Buggy findIndex('undo') = 2 (raw) → sorted[2] = color (WRONG)
    //    Fixed findSortedIndex('undo') = 1 → sorted[1] = undo (CORRECT)

    // Each fixture branch already exists in the sidebar as a REVIEW PR
    // (category "Waiting for Author" / "Approved by You"). When a session
    // is created for that branch, `buildSidebarItems` keeps the row in
    // its review section and the icon flips from `○` (review, no session)
    // to one of ◉ / ◎ / ● depending on selection + running state.
    //
    // Icon map: ◉ selected+running, ◎ selected+stopped,
    //           ● not-selected+running, ○ not-selected+stopped.
    // The helper accepts any of the four — selection shifts as later
    // sessions are created, and exact selection state is asserted
    // separately below in steps 5 and 6.
    await createSessionViaBranchPicker(
      terminal,
      'fixture/add-color',
      /[◉◎●○].*Add color support/g
    );

    await createSessionViaBranchPicker(
      terminal,
      'fixture/add-ai-solver',
      /[◉◎●○].*Add AI solver/g
    );

    // 3. Wait for PR data to load (PR badges should appear)
    await expect(terminal.getByText('#39', { strict: false })).toBeVisible({
      timeout: 30_000,
    });

    // 4. Create the third session: fixture/add-undo-feature (PR #38)
    //    This is the session that exposes the bug.
    await createSessionViaBranchPicker(
      terminal,
      'fixture/add-undo',
      /[◉◎●○].*Add undo feature/g
    );

    // 5. The selection indicator (◉ running, ◎ stopped) should be on the
    //    newly created session.
    await expect(
      terminal.getByText(/[◉◎].*Add undo feature/g, { strict: false })
    ).toBeVisible();

    // 6. Confirm the indicator is NOT on the wrong session (color-support).
    //    Color is de-selected now — should show the un-selected variants
    //    (● running / ○ stopped), not [◉◎].
    expect(
      terminal.getByText(/[◉◎].*Add color support/g, { strict: false })
    ).not.toBeVisible();
  }
);
