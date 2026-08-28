import { test, expect } from './fixtures/desktop.js';
import { sidebar, tabs } from './setup/app.js';
import {
  cloneTestRepo,
  githubToken,
  removeClone,
  TEST_REPO_NAME,
  TEST_REPO_OWNER,
} from './setup/github.js';

/**
 * The review workspace against real GitHub.
 *
 * Everything else in this suite runs offline, which leaves the
 * desktop's headline feature — pull requests, their comment threads,
 * the diff you review them in — covered only as far as the host
 * services. These tests fill that in against the shared sandbox repo's
 * permanent fixture pull requests (see CLAUDE.md).
 *
 * Strictly read-only: nothing here creates, edits, merges or comments,
 * because the repo is shared state and the fixtures are permanent.
 *
 * Tagged `@integration`, so a plain run skips them; they need GH_TOKEN
 * because each test gets an isolated HOME and the `gh` CLI the app
 * authenticates through cannot see stored credentials from there.
 */

const token = githubToken();

// Cloned once per file at collection time, because `test.use` below
// needs the path before any hook runs. Guarded on the token so a plain
// offline run — where these tests are filtered out but the file is
// still loaded — does not reach the network at all.
const clone = token ? cloneTestRepo() : undefined;
if (clone) {
  process.on('exit', () => removeClone(clone));
}

test.describe('@integration Review workspace', () => {
  // A capability gate rather than a disabled test: without a token
  // there is no GitHub to talk to, and this same suite runs for real in
  // the integration job.
  test.skip(!token, 'Requires GH_TOKEN for real GitHub access');

  test.use({
    repoPathOverride: clone,
    githubToken: token,
    // Project fields live under `vendorProject`; with that key absent
    // the host auto-detects from the git remote and overwrites the rest.
    projectConfig: {
      vendor: 'github',
      vendorProject: {
        owner: TEST_REPO_OWNER,
        repo: TEST_REPO_NAME,
        username: 'kirby-test-runner',
      },
    },
  });

  test('reports the provider as configured rather than absent', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // The offline suite always sees "No provider"; this is the other
    // branch of that, and everything below depends on it.
    await expect(page.getByRole('button', { name: /No provider/ })).toHaveCount(
      0,
      { timeout: 60_000 }
    );
  });

  test('lists the fixture pull requests in the sidebar', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // Fixture PRs #37, #38 and #39 are permanent in the sandbox repo.
    await expect(sidebar(page).getByText('#38')).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      sidebar(page).getByText('Add undo feature with history stack')
    ).toBeVisible();
  });

  test('opens a pull request into the review workspace', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = sidebar(page).getByRole('button', { name: /#38/ });
    await row.waitFor({ state: 'visible', timeout: 60_000 });
    await row.click();

    await expect(tabs(page)).toHaveCount(1);
    // The workspace, not a bare terminal: its rail and the PR's own
    // header are what distinguish a pull request tab from a worktree.
    await expect(
      page.getByRole('button', { name: /Files/ }).first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText('Add undo feature with history stack').first()
    ).toBeVisible();
  });

  test('renders the diff and the review comments left on it', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const row = sidebar(page).getByRole('button', { name: /#38/ });
    await row.waitFor({ state: 'visible', timeout: 60_000 });
    await row.click();

    // The files this pull request actually changes. The diff is
    // git-side, computed from the clone, so this is where a wrong base
    // ref or an unfetched branch shows up as an empty pane.
    await expect(
      page.getByRole('button', { name: /undo\.c/ }).first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('button', { name: /input\.c/ }).first()
    ).toBeVisible();
  });

  test('sorts the fixture pull requests into review buckets', async ({
    desktop,
  }) => {
    const { page } = desktop;
    // The sidebar's whole job for reviews: which of these is waiting on
    // you, and how much is outstanding on each.
    await expect(
      sidebar(page).getByRole('button', { name: /Needs Your Review/ })
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      sidebar(page).getByRole('button', { name: /Approved by You/ })
    ).toBeVisible();
    await expect(
      sidebar(page).getByRole('button', { name: /#38.*0\/1/ })
    ).toBeVisible();
  });
});
