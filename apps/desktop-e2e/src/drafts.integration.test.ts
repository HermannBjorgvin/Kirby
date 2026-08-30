import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/desktop.js';
import { sidebar } from './setup/app.js';
import {
  cloneTestRepo,
  githubToken,
  removeClone,
  TEST_REPO_NAME,
  TEST_REPO_OWNER,
} from './setup/github.js';

/**
 * The draft review flow: what the review agent writes, and what you do
 * with it before any of it reaches GitHub.
 *
 * The agent leaves comments in ~/.kirby/reviews/pr-<id>/comments.json
 * through `kirby util add-comment`; the desktop picks them up, shows
 * them against the code they were written about, and walks you through
 * them in severity order. Everything up to the moment of posting is
 * covered here — posting itself is left alone, because these fixture
 * pull requests are permanent shared state.
 */

const token = githubToken();
const clone = token ? cloneTestRepo() : undefined;
if (clone) {
  process.on('exit', () => removeClone(clone));
}

const PR_ID = 38;

/** Drafts as the agent would have written them, on files #38 changes. */
const DRAFTS = [
  {
    id: 'draft-major',
    file: 'src/undo.c',
    lineStart: 1,
    lineEnd: 1,
    severity: 'major',
    body: 'The undo stack is never bounded.',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'draft-minor',
    file: 'src/input.c',
    lineStart: 1,
    lineEnd: 1,
    severity: 'minor',
    body: 'Nit: this branch reads better inverted.',
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01T00:00:01.000Z',
  },
];

test.describe('@integration Agent draft comments', () => {
  // A capability gate rather than a disabled test: without a token
  // there is no GitHub to talk to, and this same suite runs for real in
  // the integration job.
  test.skip(!token, 'Requires GH_TOKEN for real GitHub access');

  test.use({
    repoPathOverride: clone,
    githubToken: token,
    drafts: { [PR_ID]: DRAFTS },
    projectConfig: {
      vendor: 'github',
      vendorProject: {
        owner: TEST_REPO_OWNER,
        repo: TEST_REPO_NAME,
        username: 'kirby-test-runner',
      },
    },
  });

  async function openPr(page: Page) {
    const row = sidebar(page).getByRole('button', {
      name: new RegExp(`#${PR_ID}`),
    });
    await row.waitFor({ state: 'visible', timeout: 60_000 });
    await row.click();
  }

  test('surfaces what the agent wrote, with its severities', async ({
    desktop,
  }) => {
    const { page } = desktop;
    await openPr(page);

    // The rail advertises a finished review rather than making you go
    // looking for it in the diff.
    await expect(
      page.getByRole('button', { name: /Review ready|Review/ }).first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText('The undo stack is never bounded.')
    ).toBeVisible({ timeout: 60_000 });
  });

  test('reads the drafts through the bridge exactly as stored', async ({
    desktop,
  }) => {
    const { page } = desktop;
    const listed = await page.evaluate(
      (id) =>
        (
          window.kirby as never as {
            listDraftComments(prId: number): Promise<{ id: string }[]>;
          }
        ).listDraftComments(id),
      PR_ID
    );
    expect(listed.map((c) => c.id).sort()).toEqual([
      'draft-major',
      'draft-minor',
    ]);
  });

  test('an edit reaches the file the agent wrote', async ({ desktop }) => {
    const { page, homeDir } = desktop;
    await page.evaluate(
      (id) =>
        (
          window.kirby as never as {
            updateDraftComment(
              prId: number,
              commentId: string,
              patch: Record<string, unknown>
            ): Promise<void>;
          }
        ).updateDraftComment(id, 'draft-minor', { body: 'Edited by hand.' }),
      PR_ID
    );

    // Edits belong in the same file the agent appends to, so a later
    // `add-comment` run does not overwrite them.
    const stored = JSON.parse(
      readFileSync(
        join(homeDir, '.kirby', 'reviews', `pr-${PR_ID}`, 'comments.json'),
        'utf8'
      )
    ) as { comments: { id: string; body: string }[] };
    expect(stored.comments.find((c) => c.id === 'draft-minor')?.body).toBe(
      'Edited by hand.'
    );
  });

  test('discarding one leaves the rest alone', async ({ desktop }) => {
    const { page } = desktop;
    await page.evaluate(
      (id) =>
        (
          window.kirby as never as {
            deleteDraftComment(prId: number, commentId: string): Promise<void>;
          }
        ).deleteDraftComment(id, 'draft-minor'),
      PR_ID
    );

    const listed = await page.evaluate(
      (id) =>
        (
          window.kirby as never as {
            listDraftComments(prId: number): Promise<{ id: string }[]>;
          }
        ).listDraftComments(id),
      PR_ID
    );
    expect(listed.map((c) => c.id)).toEqual(['draft-major']);
  });
});
