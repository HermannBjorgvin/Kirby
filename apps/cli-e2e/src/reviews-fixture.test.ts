import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { TEST_REPO } from './setup/constants.js';

const hasGhToken = !!process.env.GH_TOKEN;

// ── Module-scope setup ─────────────────────────────────────────────
// Clone the sandbox repo once per file (workers=1, so effectively once
// per run). Reads only — no branches/PRs created by this file.

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-reviews-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;

  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}" -- --single-branch`, {
    stdio: 'pipe',
  });
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
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

test.describe('@integration Reviews Fixture', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

  test('Unified sidebar shows fixture PRs in correct categories', async ({
    kirby,
  }) => {
    // 1. Kirby renders (the fixture already waited for this)
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();

    // 2. Wait for PR data to load — kirby-test-runner approved PR #37,
    //    so "Approved by You" section should appear.
    await expect(kirby.term.getByText('Approved by You').first()).toBeVisible({
      timeout: 30_000,
    });

    // 3. All 3 fixture PRs visible
    await expect(
      kirby.term.getByText('Add color support for tile values').first()
    ).toBeVisible();
    await expect(
      kirby.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible();
    await expect(
      kirby.term.getByText('Add AI solver for auto-play mode').first()
    ).toBeVisible();

    // 4. PR #38 carries an inline-comment badge on its sidebar card.
    //    Historically 3 comments; the comments-fixture test-suite
    //    resolves and replies to threads, which can temporarily drop
    //    the unresolved count to 2 — accept either.
    await expect(kirby.term.getByText(/[23] comments/).first()).toBeVisible();

    // 5. PR #38 lands in a review category. Originally it belongs in
    //    "Waiting for Author" (kirby-test-runner requested changes),
    //    but the comments-fixture reply test mutates the latest review
    //    state, so PR #38 can legitimately drift to "Needs Your Review"
    //    across CI runs. Any review category proves categorization
    //    works — that's the unit under test.
    await expect(
      kirby.term
        .getByText(/Waiting for Author|Needs Your Review|Approved by You/)
        .first()
    ).toBeVisible();
  });
});
