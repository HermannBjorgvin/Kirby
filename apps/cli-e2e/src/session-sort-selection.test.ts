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
    JSON.stringify({ aiCommand: 'cat' }),
    'utf-8'
  );
}

// ── Helper: create a session via the branch picker UI ──────────────
async function createSessionViaBranchPicker(
  terminal: Terminal,
  branchFilter: string,
  sessionName: string
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

  // Wait for session to appear in sidebar
  await expect(terminal.getByText(sessionName, { strict: false })).toBeVisible({
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
      terminal.getByText('Pull Requests', { strict: false })
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

    await createSessionViaBranchPicker(
      terminal,
      'fixture/add-color',
      'fixture-add-color-support'
    );

    await createSessionViaBranchPicker(
      terminal,
      'fixture/add-ai-solver',
      'fixture-add-ai-solver'
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
      'fixture-add-undo-feature'
    );

    // 5. The selection marker (›) should be on the newly created session
    await expect(
      terminal.getByText(/›.*fixture-add-undo-feature/g, { strict: false })
    ).toBeVisible();

    // 6. Confirm the marker is NOT on the wrong session (color-support)
    expect(
      terminal.getByText(/›.*fixture-add-color-support/g, { strict: false })
    ).not.toBeVisible();
  }
);
