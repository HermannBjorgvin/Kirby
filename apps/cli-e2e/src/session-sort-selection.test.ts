import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO } from './setup/constants.js';
import { sidebarLocator } from './setup/sidebar.js';
import type { KirbyTerm } from './fixtures/kirby.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-sort-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  // Use HTTPS URL directly — gh repo clone may default to SSH which can be
  // blocked. Clone all branches (needed for the branch picker).
  const token = process.env.GH_TOKEN;
  execSync(
    `git clone "https://x-access-token:${token}@github.com/${TEST_REPO}.git" "${cloneDir}"`,
    { stdio: 'pipe' }
  );

  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

// ── Helper: create a session via the branch picker UI ──────────────
async function createSessionViaBranchPicker(
  term: KirbyTerm,
  branchFilter: string,
  waitForTitle: string
) {
  await term.type('c');
  await expect(term.getByText('Branch Picker').first()).toBeVisible();

  await term.type(branchFilter);
  await expect(term.getByText(`/ ${branchFilter}`).first()).toBeVisible();

  await term.press('Enter');

  // Branch picker closes first (setCreating(false) is sync); worktree
  // creation is async. Wait for the picker to close before asserting
  // the session row.
  await expect(term.getByText('Branch Picker').first()).not.toBeVisible();

  // Wait for the session row in any icon state (selected or not, running or not).
  await expect(sidebarLocator(term.page, waitForTitle).any()).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('@integration Session Sort Selection', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { aiCommand: 'cat', keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

  test('selects correct session after branch picker creation in sorted sidebar', async ({
    kirby,
  }) => {
    // 1. Wait for PR data to load (reviews section appears)
    await expect(kirby.term.getByText('Approved by You').first()).toBeVisible();

    // 2. Create sessions in an order that DIFFERS from PR-sorted order.
    //    Sorted order (desc PR ID): ai-solver(#39), undo(#38), color(#37)
    //    Creation order:            color(#37), ai-solver(#39), undo(#38)
    //
    //    This makes raw indices differ from sorted indices:
    //      Raw (creation order): [color=0, ai-solver=1, undo=2]
    //      Sorted (desc PR):    [ai-solver=0, undo=1, color=2]
    //
    //    Buggy findIndex('undo') = 2 (raw) → sorted[2] = color (WRONG)
    //    Fixed findSortedIndex('undo') = 1 → sorted[1] = undo (CORRECT)

    await createSessionViaBranchPicker(
      kirby.term,
      'fixture/add-color',
      'Add color support'
    );
    await createSessionViaBranchPicker(
      kirby.term,
      'fixture/add-ai-solver',
      'Add AI solver'
    );

    // 3. Wait for PR data on the sessions (#39 badge appears)
    await expect(kirby.term.getByText('#39').first()).toBeVisible({
      timeout: 30_000,
    });

    // 4. Create the third session (fixture/add-undo-feature / PR #38).
    //    This session exposes the bug.
    await createSessionViaBranchPicker(
      kirby.term,
      'fixture/add-undo',
      'Add undo feature'
    );

    // 5. The selection indicator should be on the newly created session.
    //    Selection lands via lastResolvedIndex fallback (see
    //    project_selectbykey_latent_bug memory) which requires a render
    //    cycle after PR-data post-fetch reconciliation — default 5s
    //    isn't always enough on the CI runner under load.
    await expect(
      sidebarLocator(kirby.term.page, 'Add undo feature').selected()
    ).toBeVisible({ timeout: 15_000 });

    // 6. Confirm selection is NOT on the wrong session (color-support).
    await expect(
      sidebarLocator(kirby.term.page, 'Add color support').selected()
    ).not.toBeVisible();
  });
});
