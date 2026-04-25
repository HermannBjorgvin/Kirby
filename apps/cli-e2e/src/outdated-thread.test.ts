import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { TEST_REPO } from './setup/constants.js';

// Verifies the diff viewer renders outdated review threads inline at
// their `originalLine` instead of dropping them into the
// "comments on lines not in diff" tail.
//
// PR #322 (`fixture/outdated-thread`) is a permanent fixture in the
// test repo: two commits where the second rewrites the function the
// review comment was anchored to, so GitHub flags the thread
// `isOutdated: true` with `line: null` and only `originalLine: 10`
// surviving in the GraphQL response. Without the originalLine
// fallback in the GitHub provider the thread would land in the
// out-of-diff tail and never surface in the inline viewport.

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-outdated-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  // Need both fixture/outdated-thread and main locally — the diff
  // viewer resolves both refs to compute the per-file diff.
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}"`, { stdio: 'pipe' });
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
  execSync('git fetch origin fixture/outdated-thread', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

test.describe('@integration Outdated Thread Fixture', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { keybindPreset: 'vim' },
    // Pass GH_TOKEN through explicitly so the spawned Kirby's gh CLI
    // can authenticate even when Playwright reuses a wterm-host that
    // wasn't started with the env (e.g. local dev where the host has
    // been running across shell sessions). The CI runner spawns a
    // fresh host per job, so this is also safe there.
    kirbyEnv: { GH_TOKEN: process.env.GH_TOKEN ?? '' },
    rows: 60,
    cols: 120,
  });

  // Same race-tolerant selection helper as comments-fixture.
  async function pressUntilSelected(
    kirby: { term: { press: (k: string) => Promise<void> } },
    selectedLocator: Locator,
    maxPresses: number
  ): Promise<boolean> {
    for (let i = 0; i <= maxPresses; i++) {
      try {
        await selectedLocator.waitFor({ state: 'visible', timeout: 1_500 });
        return true;
      } catch {
        if (i === maxPresses) return false;
        await kirby.term.press('j');
      }
    }
    return false;
  }

  async function openOutdatedThreadDiff(kirby: {
    term: {
      page: Page;
      press: (k: string) => Promise<void>;
      getByText: Page['getByText'];
    };
  }) {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(
      kirby.term.getByText(/Outdated thread fixture/).first()
    ).toBeVisible({ timeout: 30_000 });

    const pr = sidebarLocator(kirby.term.page, 'Outdated thread fixture');
    const landed = await pressUntilSelected(
      { term: kirby.term },
      pr.selected().first(),
      20
    );
    if (!landed) {
      throw new Error('Could not land sidebar selection on PR #322');
    }

    await kirby.term.press('d');

    // Wait for the file-list to appear with the fixture file.
    await kirby.term.page
      .locator('.term-row', { hasText: /outdated-thread-fixture\.c/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    // Single file in this PR — pressing Enter on the (already-selected)
    // first row opens the diff.
    await kirby.term.press('Enter');
    await expect(
      kirby.term.getByText('(no diff for this file)')
    ).not.toBeVisible({ timeout: 30_000 });
  }

  test('outdated thread renders inline with the (outdated) tag', async ({
    kirby,
  }) => {
    await openOutdatedThreadDiff({ term: kirby.term });

    // The fixture comment body — anchored to original line 10. With
    // the originalLine fallback in transformReviewThread, the thread
    // renders inline; without it, the thread would be in the tail
    // section past the end of the diff and this assertion would only
    // pass if the test scrolled to the bottom (it doesn't).
    await expect(
      kirby.term
        .getByText(/Fixture comment anchored to the original line 10/)
        .first()
    ).toBeVisible({ timeout: 15_000 });

    // The (outdated) marker is part of the card header. Confirms we
    // propagated `isOutdated: true` through the provider transform.
    await expect(kirby.term.getByText(/\(outdated\)/).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
