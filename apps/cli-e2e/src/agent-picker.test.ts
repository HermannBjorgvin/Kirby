import { test, expect, type N10Term } from './fixtures/n10.js';
import { settleFor } from './setup/waits.js';
import { dismissSessionMenu } from './setup/sessions.js';

// The session menu's agent selector. Each arrow press is followed by a
// polling visibility assertion (not pressUntil — cycling is not
// idempotent, a re-delivered arrow would land on the wrong agent).
//
// No test here presses Enter on "Open / resume session": the fixture
// config has no aiCommand, so that would launch a real `claude`.

const MENU_PROMPT = 'What would you like to do?';

/** Create a branch through the picker; creation lands in the menu. */
async function createBranchIntoMenu(term: N10Term, branch: string) {
  await term.type('c');
  await expect(term.getByText('Branch Picker')).toBeVisible();
  await term.type(branch);
  await expect(term.getByText(/\(new branch\)/).first()).toBeVisible({
    timeout: 5_000,
  });
  await settleFor(
    term.page,
    2_000,
    "Ink's useInput captured the old filter until the next render"
  );
  await term.press('Enter');
  // Worktree creation finishes by opening the new session's menu.
  await expect(term.getByText(MENU_PROMPT)).toBeVisible({ timeout: 15_000 });
}

test.describe('Session menu agent selector', () => {
  test('creating a branch lands in the session menu with the default agent', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await createBranchIntoMenu(n10.term, 'agent-menu');

    // No PR on a fresh branch → no review rows, just start + cancel.
    await expect(n10.term.getByText('Open / resume session')).toBeVisible();
    await expect(n10.term.getByText('Start/Continue review')).toBeHidden();

    // Automatic selection preserves a recorded agent on later opens.
    await expect(n10.term.getByText('Recorded agent / default')).toBeVisible();

    // Arrows cycle the agent for this session only.
    await n10.term.press('ArrowRight');
    await expect(n10.term.getByText('Claude (default)')).toBeVisible();
    await expect(n10.term.getByText('Start new session')).toBeVisible();
    await n10.term.press('ArrowRight');
    await expect(n10.term.getByText('Codex')).toBeVisible();

    // Left through the named default and automatic choice wraps to the end.
    await n10.term.press('ArrowLeft');
    await expect(n10.term.getByText('Claude (default)')).toBeVisible();
    await n10.term.press('ArrowLeft');
    await expect(n10.term.getByText('Recorded agent / default')).toBeVisible();
    await n10.term.press('ArrowLeft');
    await expect(n10.term.getByText('OpenCode')).toBeVisible();

    // Esc dismisses the menu back to the sidebar.
    await n10.term.press('Escape');
    await expect(n10.term.getByText(MENU_PROMPT)).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test('Tab on a non-running session reopens the menu with the default agent', async ({
    n10,
  }) => {
    await expect(n10.term.getByText('n10').first()).toBeVisible();
    await createBranchIntoMenu(n10.term, 'agent-reset');

    // Cycle away from the default, then dismiss.
    await n10.term.press('ArrowRight');
    await expect(n10.term.getByText('Claude (default)')).toBeVisible();
    await expect(n10.term.getByText('Start new session')).toBeVisible();
    await n10.term.press('ArrowRight');
    await expect(n10.term.getByText('Codex')).toBeVisible();
    await dismissSessionMenu(n10.term);

    // Tab on the still-selected, not-running session reopens the menu;
    // the agent choice is per-open and resets to the default.
    await n10.term.press('Tab');
    await expect(n10.term.getByText(MENU_PROMPT)).toBeVisible({
      timeout: 5_000,
    });
    await expect(n10.term.getByText('Recorded agent / default')).toBeVisible();
  });
});
