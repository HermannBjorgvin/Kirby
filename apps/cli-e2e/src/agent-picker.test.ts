import { test, expect } from './fixtures/kirby.js';

// The session menu's agent selector. Each arrow press is followed by a
// polling visibility assertion (not pressUntil — cycling is not
// idempotent, a re-delivered arrow would land on the wrong agent).
//
// No test here presses Enter on "Start/Continue session": the fixture
// config has no aiCommand, so that would launch a real `claude`.
test.describe('Session menu agent selector', () => {
  test('creating a branch lands in the session menu with the default agent', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
    await kirby.term.type('agent-menu');
    await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');

    // Worktree creation finishes by opening the new session's menu.
    await expect(
      kirby.term.getByText('What would you like to do?')
    ).toBeVisible({ timeout: 15_000 });

    // No PR on a fresh branch → no review rows, just start + cancel.
    await expect(kirby.term.getByText('Start/Continue session')).toBeVisible();
    await expect(
      kirby.term.getByText('Start/Continue review')
    ).not.toBeVisible();

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
    await expect(
      kirby.term.getByText('What would you like to do?')
    ).not.toBeVisible({ timeout: 5_000 });
  });

  test('Tab on a non-running session reopens the menu with the default agent', async ({
    kirby,
  }) => {
    await expect(kirby.term.getByText('Kirby').first()).toBeVisible();
    await kirby.term.type('c');
    await expect(kirby.term.getByText('Branch Picker')).toBeVisible();
    await kirby.term.type('agent-reset');
    await expect(kirby.term.getByText(/\(new branch\)/).first()).toBeVisible({
      timeout: 5_000,
    });
    await kirby.term.page.waitForTimeout(2_000);
    await kirby.term.press('Enter');
    await expect(
      kirby.term.getByText('What would you like to do?')
    ).toBeVisible({ timeout: 15_000 });

    // Cycle away from the default, then dismiss.
    await kirby.term.press('ArrowRight');
    await expect(kirby.term.getByText('Codex')).toBeVisible();
    await kirby.term.press('Escape');
    await expect(
      kirby.term.getByText('What would you like to do?')
    ).not.toBeVisible({ timeout: 5_000 });

    // Tab on the still-selected, not-running session reopens the menu;
    // the agent choice is per-open and resets to the default.
    await kirby.term.press('Tab');
    await expect(
      kirby.term.getByText('What would you like to do?')
    ).toBeVisible({ timeout: 5_000 });
    await expect(kirby.term.getByText('Claude (default)')).toBeVisible();
  });
});
