import { test, expect, type KirbyTerm } from './fixtures/kirby.js';
import { settleFor } from './setup/waits.js';
import { dismissSessionMenu } from './setup/sessions.js';

// The session menu's agent selector. Each arrow press is followed by a
// polling visibility assertion (not pressUntil — cycling is not
// idempotent, a re-delivered arrow would land on the wrong agent).
//
// No test here presses Enter on "Start/Continue session": the fixture
// config has no aiCommand, so that would launch a real `claude`.

const MENU_PROMPT = 'What would you like to do?';

/** Create a branch through the picker; creation lands in the menu. */
async function createBranchIntoMenu(term: KirbyTerm, branch: string) {
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
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await createBranchIntoMenu(kirby.term, 'agent-menu');

    // No PR on a fresh branch → no review rows, just start + cancel.
    await expect(kirby.term.getByText('Start/Continue session')).toBeVisible();
    await expect(kirby.term.getByText('Start/Continue review')).toBeHidden();

    // No agentId/aiCommand in the fixture config → registry default.
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();

    // Arrows cycle the agent for this session only.
    await kirby.term.press('ArrowRight');
    await expect(kirby.term.getByText('Codex')).toBeVisible();

    // Left twice from Codex wraps past the default to the end of the list.
    await kirby.term.press('ArrowLeft');
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();
    await kirby.term.press('ArrowLeft');
    await expect(kirby.term.getByText('OpenCode')).toBeVisible();

    // Esc dismisses the menu back to the sidebar.
    await kirby.term.press('Escape');
    await expect(kirby.term.getByText(MENU_PROMPT)).not.toBeVisible({
      timeout: 5_000,
    });
  });

  test('Tab on a non-running session reopens the menu with the default agent', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await createBranchIntoMenu(kirby.term, 'agent-reset');

    // Cycle away from the default, then dismiss.
    await kirby.term.press('ArrowRight');
    await expect(kirby.term.getByText('Codex')).toBeVisible();
    await dismissSessionMenu(kirby.term);

    // Tab on the still-selected, not-running session reopens the menu;
    // the agent choice is per-open and resets to the default.
    await kirby.term.press('Tab');
    await expect(kirby.term.getByText(MENU_PROMPT)).toBeVisible({
      timeout: 5_000,
    });
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();
  });
});
