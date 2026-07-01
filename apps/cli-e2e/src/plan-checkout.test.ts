import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/kirby.js';
import { registerCleanup } from './setup/git-repo.js';
import { sidebarLocator } from './setup/sidebar.js';
import { TEST_REPO } from './setup/constants.js';

// Exercises the "add comments to a plan" (add-to-cart) feature against
// fixture PR #38 (undo feature), which has inline review comments on
// src/undo.c. Stops at the checkout pane — pressing "send" would spawn a
// real `claude`, which isn't available in CI. The unit specs cover the
// send/orchestration paths (checkout-orchestrator.spec.ts).

const hasGhToken = !!process.env.GH_TOKEN;

const cloneDir = mkdtempSync(join(tmpdir(), 'kirby-plan-clone-'));
registerCleanup(cloneDir);

if (hasGhToken) {
  const token = process.env.GH_TOKEN;
  execSync(`gh repo clone "${TEST_REPO}" "${cloneDir}"`, { stdio: 'pipe' });
  execSync(
    `git remote set-url origin "https://x-access-token:${token}@github.com/${TEST_REPO}.git"`,
    { cwd: cloneDir, stdio: 'pipe' }
  );
  execSync('git config user.email "e2e@kirby.dev"', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
  execSync('git config user.name "Kirby E2E"', { cwd: cloneDir, stdio: 'pipe' });
  execSync('git fetch origin fixture/add-undo-feature', {
    cwd: cloneDir,
    stdio: 'pipe',
  });
}

test.describe('@integration Plan Checkout', () => {
  test.skip(!hasGhToken, 'Requires GH_TOKEN for real GitHub ops');

  test.use({
    kirbyRepoPath: cloneDir,
    kirbyConfig: { keybindPreset: 'vim' },
    rows: 60,
    cols: 120,
  });

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

  async function openPr38DiffAndSelectThread(kirby: {
    term: {
      page: Page;
      press: (k: string) => Promise<void>;
      getByText: Page['getByText'];
    };
  }) {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await expect(
      kirby.term.getByText('Add undo feature with history stack').first()
    ).toBeVisible({ timeout: 30_000 });

    const pr38 = sidebarLocator(kirby.term.page, 'Add undo feature');
    const landed = await pressUntilSelected(
      { term: kirby.term },
      pr38.selected().first(),
      20
    );
    if (!landed) throw new Error('Could not select PR #38');

    await kirby.term.press('d');
    await kirby.term.page
      .locator('.term-row', { hasText: /undo\.c/ })
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 });

    const undoSelected = kirby.term.page
      .locator('.term-row', { hasText: /›.*undo\.c/ })
      .first();
    const gotUndo = await pressUntilSelected(
      { term: kirby.term },
      undoSelected,
      10
    );
    if (!gotUndo) throw new Error('Could not select src/undo.c');

    await kirby.term.press('Enter');
    await expect(kirby.term.getByText(/Magic number/).first()).toBeVisible({
      timeout: 30_000,
    });

    // Select the first remote thread (vim: c = next-comment). The
    // [r]eply hint confirms the selection committed.
    await kirby.term.press('c');
    await expect(kirby.term.getByText(/\[r\]eply/).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  test('add a comment to the plan, annotate it, and open checkout', async ({
    kirby,
  }) => {
    await openPr38DiffAndSelectThread({ term: kirby.term });

    // `a` adds the selected thread to the plan — the top-right indicator
    // shows "Plan (1)".
    await kirby.term.press('a');
    await expect(kirby.term.getByText(/Plan \(1\)/).first()).toBeVisible({
      timeout: 10_000,
    });

    // `o` (vim checkout) opens the interactive checklist pane.
    await kirby.term.press('o');
    await expect(
      kirby.term.getByText(/Plan Checkout \(1\)/).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(kirby.term.getByText(/undo\.c:/).first()).toBeVisible({
      timeout: 5_000,
    });

    // Esc returns to the diff, plan intact.
    await kirby.term.press('Escape');
    await expect(kirby.term.getByText(/Plan \(1\)/).first()).toBeVisible({
      timeout: 5_000,
    });
  });

  test('toggling a comment off removes it from the plan', async ({ kirby }) => {
    await openPr38DiffAndSelectThread({ term: kirby.term });

    await kirby.term.press('a');
    await expect(kirby.term.getByText(/Plan \(1\)/).first()).toBeVisible({
      timeout: 10_000,
    });

    // Second `a` toggles it back off — the indicator disappears.
    await kirby.term.press('a');
    await expect(kirby.term.getByText(/Plan \(1\)/)).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
